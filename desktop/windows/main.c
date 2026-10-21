/* Native Win32 host. Only Windows system DLLs and the official WebView2 Loader
 * are required. The offline build never falls back to an installed runtime. */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <commdlg.h>
#include <aclapi.h>
#include <sddl.h>
#include <stdio.h>
#include <wchar.h>
#include <WebView2.h>

#define CAP 32768
/* Stable local origin and profile paths preserve existing Liubai board data. */
#define ORIGIN L"https://liubai.localhost/"
#define WM_CLOSE_SAVED (WM_APP + 1)
#define WM_SAVE_DOWNLOAD (WM_APP + 2)
#define WM_REQUEST_CLOSE (WM_APP + 3)
#ifndef INKISLE_OFFLINE
#define INKISLE_OFFLINE 0
#endif

static HWND window;
static HMODULE loader;
static ICoreWebView2Controller *controller;
static ICoreWebView2 *webview;
static HANDLE profile_lock;
static HANDLE browser_process;
static wchar_t base[CAP], resources[CAP], profile[CAP], runtime[CAP], logs[CAP];
static wchar_t browser_args[2048];
static BOOL test_mode, page_ready, closing;
static int exit_code;
static const wchar_t *download_site = L"https://developer.microsoft.com/microsoft-edge/webview2/consumer/";

typedef HRESULT (STDAPICALLTYPE *CreateEnvironment)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
typedef HRESULT (STDAPICALLTYPE *GetBrowserVersion)(PCWSTR, LPWSTR *);

static BOOL path_join(wchar_t *out, const wchar_t *parent, const wchar_t *child) {
  return swprintf(out, CAP, L"%ls\\%ls", parent, child) > 0;
}

static BOOL exists(const wchar_t *path) { return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES; }
static BOOL local_uri(const wchar_t *uri) { return uri && wcsncmp(uri, ORIGIN, wcslen(ORIGIN)) == 0; }

static void log_line(const wchar_t *text, HRESULT code) {
  wchar_t path[CAP]; path_join(path, logs, L"desktop.log");
  HANDLE file = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME time; GetLocalTime(&time);
  wchar_t line[2048]; swprintf(line, 2048, L"%04u-%02u-%02u %02u:%02u:%02u %ls [0x%08lX]\r\n", time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, text, (unsigned long)code);
  char utf8[8192]; int length = WideCharToMultiByte(CP_UTF8, 0, line, -1, utf8, sizeof utf8, NULL, NULL); DWORD written;
  if (length > 0) WriteFile(file, utf8, (DWORD)length - 1, &written, NULL);
  CloseHandle(file);
}

static void fatal(const wchar_t *text, HRESULT code, int status) {
  exit_code = status; log_line(text, code);
  if (!test_mode) {
    wchar_t message[4096]; swprintf(message, 4096, L"%ls\n\n错误代码：0x%08lX\n\n请完整解压压缩包后再运行。", text, (unsigned long)code);
    MessageBoxW(window, message, L"墨屿 · 无法启动", MB_OK | MB_ICONERROR);
  }
  if (window) DestroyWindow(window);
}

/* Static callback objects outlive the WebView; exact IID checks avoid treating
 * optional COM interface probes as if their incompatible vtables were present. */
#define CALLBACK_IUNKNOWN(Name, Type) \
  static HRESULT STDMETHODCALLTYPE Name##_query(Type *self, REFIID iid, void **out) { \
    if (!out) return E_POINTER; *out = NULL; \
    if (!IsEqualIID(iid, &IID_IUnknown) && !IsEqualIID(iid, &IID_##Type)) return E_NOINTERFACE; \
    *out = self; return S_OK; \
  } \
  static ULONG STDMETHODCALLTYPE Name##_addref(Type *self) { (void)self; return 2; } \
  static ULONG STDMETHODCALLTYPE Name##_release(Type *self) { (void)self; return 1; }

CALLBACK_IUNKNOWN(options, ICoreWebView2EnvironmentOptions)
static HRESULT copy_string(const wchar_t *value, LPWSTR *out) {
  if (!out) return E_POINTER;
  size_t bytes = (wcslen(value) + 1) * sizeof(wchar_t); *out = CoTaskMemAlloc(bytes);
  if (!*out) return E_OUTOFMEMORY; memcpy(*out, value, bytes); return S_OK;
}
static HRESULT STDMETHODCALLTYPE options_args(ICoreWebView2EnvironmentOptions *self, LPWSTR *out) { (void)self; return copy_string(browser_args, out); }
static HRESULT STDMETHODCALLTYPE options_language(ICoreWebView2EnvironmentOptions *self, LPWSTR *out) { (void)self; return copy_string(L"zh-CN", out); }
static HRESULT STDMETHODCALLTYPE options_version(ICoreWebView2EnvironmentOptions *self, LPWSTR *out) { (void)self; return copy_string(L"100.0.1150.0", out); }
static HRESULT STDMETHODCALLTYPE options_set_string(ICoreWebView2EnvironmentOptions *self, LPCWSTR value) { (void)self; (void)value; return E_NOTIMPL; }
static HRESULT STDMETHODCALLTYPE options_sso(ICoreWebView2EnvironmentOptions *self, BOOL *out) { (void)self; if (!out) return E_POINTER; *out = FALSE; return S_OK; }
static HRESULT STDMETHODCALLTYPE options_set_sso(ICoreWebView2EnvironmentOptions *self, BOOL value) { (void)self; (void)value; return E_NOTIMPL; }
static ICoreWebView2EnvironmentOptionsVtbl options_vtable = { options_query, options_addref, options_release, options_args, options_set_string, options_language, options_set_string, options_version, options_set_string, options_sso, options_set_sso };
static ICoreWebView2EnvironmentOptions options_object = { &options_vtable };

CALLBACK_IUNKNOWN(navigation, ICoreWebView2NavigationStartingEventHandler)
static HRESULT STDMETHODCALLTYPE navigation_invoke(ICoreWebView2NavigationStartingEventHandler *self, ICoreWebView2 *sender, ICoreWebView2NavigationStartingEventArgs *args) {
  (void)self; (void)sender;
  LPWSTR uri = NULL; BOOL initiated = FALSE;
  ICoreWebView2NavigationStartingEventArgs_get_Uri(args, &uri);
  ICoreWebView2NavigationStartingEventArgs_get_IsUserInitiated(args, &initiated);
  /* Blob URLs are needed for download anchors, but never navigate to arbitrary
   * file:, javascript:, external app protocols or remote pages. */
  if (!local_uri(uri) && (!uri || wcsncmp(uri, L"blob:" ORIGIN, wcslen(L"blob:" ORIGIN)) != 0)) {
    ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
    if (initiated && uri && (wcsncmp(uri, L"https://", 8) == 0 || wcsncmp(uri, L"http://", 7) == 0)) ShellExecuteW(window, L"open", uri, NULL, NULL, SW_SHOWNORMAL);
  }
  CoTaskMemFree(uri); return S_OK;
}
static ICoreWebView2NavigationStartingEventHandlerVtbl navigation_vtable = { navigation_query, navigation_addref, navigation_release, navigation_invoke };
static ICoreWebView2NavigationStartingEventHandler navigation_object = { &navigation_vtable };

CALLBACK_IUNKNOWN(new_window, ICoreWebView2NewWindowRequestedEventHandler)
static HRESULT STDMETHODCALLTYPE new_window_invoke(ICoreWebView2NewWindowRequestedEventHandler *self, ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args) {
  (void)self; (void)sender;
  LPWSTR uri = NULL; BOOL initiated = FALSE;
  ICoreWebView2NewWindowRequestedEventArgs_put_Handled(args, TRUE);
  ICoreWebView2NewWindowRequestedEventArgs_get_Uri(args, &uri);
  ICoreWebView2NewWindowRequestedEventArgs_get_IsUserInitiated(args, &initiated);
  if (initiated && uri && (wcsncmp(uri, L"https://", 8) == 0 || wcsncmp(uri, L"http://", 7) == 0)) ShellExecuteW(window, L"open", uri, NULL, NULL, SW_SHOWNORMAL);
  CoTaskMemFree(uri); return S_OK;
}
static ICoreWebView2NewWindowRequestedEventHandlerVtbl new_window_vtable = { new_window_query, new_window_addref, new_window_release, new_window_invoke };
static ICoreWebView2NewWindowRequestedEventHandler new_window_object = { &new_window_vtable };

CALLBACK_IUNKNOWN(title, ICoreWebView2DocumentTitleChangedEventHandler)
static HRESULT STDMETHODCALLTYPE title_invoke(ICoreWebView2DocumentTitleChangedEventHandler *self, ICoreWebView2 *sender, IUnknown *args) {
  (void)self; (void)args; LPWSTR text = NULL;
  if (SUCCEEDED(ICoreWebView2_get_DocumentTitle(sender, &text)) && text) SetWindowTextW(window, text);
  CoTaskMemFree(text); return S_OK;
}
static ICoreWebView2DocumentTitleChangedEventHandlerVtbl title_vtable = { title_query, title_addref, title_release, title_invoke };
static ICoreWebView2DocumentTitleChangedEventHandler title_object = { &title_vtable };

CALLBACK_IUNKNOWN(message, ICoreWebView2WebMessageReceivedEventHandler)
static HRESULT STDMETHODCALLTYPE message_invoke(ICoreWebView2WebMessageReceivedEventHandler *self, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args) {
  (void)self; (void)sender; LPWSTR source = NULL, text = NULL;
  ICoreWebView2WebMessageReceivedEventArgs_get_Source(args, &source);
  if (local_uri(source) && SUCCEEDED(ICoreWebView2WebMessageReceivedEventArgs_TryGetWebMessageAsString(args, &text))) {
    if (wcscmp(text, L"liubai:ready") == 0) { page_ready = TRUE; log_line(L"frontend-ready", S_OK); }
    else if (closing && wcscmp(text, L"liubai:close-ready") == 0) PostMessageW(window, WM_CLOSE_SAVED, 0, 0);
    else if (wcscmp(text, L"liubai:close-blocked") == 0) { closing = FALSE; KillTimer(window, 1); }
    /* Only enabled with an explicit --test-port; normal launches cannot be
     * remotely closed by an application message. */
    else if (test_mode && wcscmp(text, L"liubai:test-close") == 0) PostMessageW(window, WM_REQUEST_CLOSE, 0, 0);
  }
  CoTaskMemFree(source); CoTaskMemFree(text); return S_OK;
}
static ICoreWebView2WebMessageReceivedEventHandlerVtbl message_vtable = { message_query, message_addref, message_release, message_invoke };
static ICoreWebView2WebMessageReceivedEventHandler message_object = { &message_vtable };

CALLBACK_IUNKNOWN(download, ICoreWebView2DownloadStartingEventHandler)
typedef struct { ICoreWebView2DownloadStartingEventArgs *args; ICoreWebView2Deferral *deferral; } PendingDownload;
static HRESULT STDMETHODCALLTYPE download_invoke(ICoreWebView2DownloadStartingEventHandler *self, ICoreWebView2 *sender, ICoreWebView2DownloadStartingEventArgs *args) {
  (void)self; (void)sender;
  log_line(L"download-starting", S_OK);
  PendingDownload *pending = calloc(1, sizeof *pending);
  if (!pending) return E_OUTOFMEMORY;
  HRESULT hr = ICoreWebView2DownloadStartingEventArgs_GetDeferral(args, &pending->deferral);
  if (FAILED(hr)) { free(pending); return hr; }
  ICoreWebView2DownloadStartingEventArgs_AddRef(args); pending->args = args;
  PostMessageW(window, WM_SAVE_DOWNLOAD, 0, (LPARAM)pending); return S_OK;
}
static ICoreWebView2DownloadStartingEventHandlerVtbl download_vtable = { download_query, download_addref, download_release, download_invoke };
static ICoreWebView2DownloadStartingEventHandler download_object = { &download_vtable };

static void save_download(PendingDownload *pending) {
  log_line(L"download-save-dialog", S_OK);
  LPWSTR suggested = NULL; wchar_t path[CAP] = L"";
  ICoreWebView2DownloadStartingEventArgs_get_ResultFilePath(pending->args, &suggested);
  if (suggested) { wcsncpy(path, PathFindFileNameW(suggested), CAP - 1); CoTaskMemFree(suggested); }
  OPENFILENAMEW dialog = { .lStructSize = sizeof dialog, .hwndOwner = window, .lpstrFile = path, .nMaxFile = CAP,
    .lpstrFilter = L"墨屿及导出文件\0*.inkisle;*.liubai;*.png;*.svg\0所有文件\0*.*\0", .lpstrTitle = L"保存文件 · 墨屿", .Flags = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST };
  if (GetSaveFileNameW(&dialog)) ICoreWebView2DownloadStartingEventArgs_put_ResultFilePath(pending->args, path);
  else { log_line(L"download-cancelled-or-dialog-error", (HRESULT)CommDlgExtendedError()); ICoreWebView2DownloadStartingEventArgs_put_Cancel(pending->args, TRUE); }
  ICoreWebView2DownloadStartingEventArgs_put_Handled(pending->args, TRUE);
  ICoreWebView2Deferral_Complete(pending->deferral); ICoreWebView2Deferral_Release(pending->deferral);
  ICoreWebView2DownloadStartingEventArgs_Release(pending->args); free(pending);
}

CALLBACK_IUNKNOWN(created, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)
static HRESULT STDMETHODCALLTYPE created_invoke(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *self, HRESULT result, ICoreWebView2Controller *value) {
  (void)self;
  if (FAILED(result) || !value) { fatal(L"浏览器窗口创建失败。", result, 24); return S_OK; }
  controller = value; ICoreWebView2Controller_AddRef(controller);
  HRESULT hr = ICoreWebView2Controller_get_CoreWebView2(controller, &webview);
  if (FAILED(hr)) { fatal(L"无法取得浏览器视图。", hr, 25); return S_OK; }
  UINT32 browser_pid = 0; ICoreWebView2_get_BrowserProcessId(webview, &browser_pid);
  browser_process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, browser_pid);
  if (INKISLE_OFFLINE) {
    wchar_t actual[CAP], expected[CAP]; DWORD length = CAP;
    path_join(expected, runtime, L"msedgewebview2.exe");
    if (!browser_process || !QueryFullProcessImageNameW(browser_process, 0, actual, &length) || _wcsicmp(actual, expected) != 0) {
      fatal(L"上一次 WebView2 进程仍在退出，请稍后重新打开离线版。未使用系统运行库继续运行。", E_UNEXPECTED, 27); return S_OK;
    }
  }
  ICoreWebView2_3 *mapping = NULL;
  hr = ICoreWebView2_QueryInterface(webview, &IID_ICoreWebView2_3, (void **)&mapping);
  if (SUCCEEDED(hr)) { hr = ICoreWebView2_3_SetVirtualHostNameToFolderMapping(mapping, L"liubai.localhost", resources, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS); ICoreWebView2_3_Release(mapping); }
  if (FAILED(hr)) { fatal(L"本地资源映射失败，请更新 WebView2。", hr, 26); return S_OK; }
  ICoreWebView2Settings *settings = NULL; ICoreWebView2_get_Settings(webview, &settings);
  if (settings) {
    ICoreWebView2Settings_put_IsStatusBarEnabled(settings, FALSE);
    ICoreWebView2Settings_put_AreDefaultContextMenusEnabled(settings, FALSE);
    ICoreWebView2Settings_put_AreDevToolsEnabled(settings, test_mode);
    ICoreWebView2Settings_put_AreHostObjectsAllowed(settings, FALSE);
    ICoreWebView2Settings_Release(settings);
  }
  EventRegistrationToken token;
  ICoreWebView2_add_NavigationStarting(webview, &navigation_object, &token);
  ICoreWebView2_add_NewWindowRequested(webview, &new_window_object, &token);
  ICoreWebView2_add_DocumentTitleChanged(webview, &title_object, &token);
  ICoreWebView2_add_WebMessageReceived(webview, &message_object, &token);
  ICoreWebView2_4 *downloads = NULL;
  if (SUCCEEDED(ICoreWebView2_QueryInterface(webview, &IID_ICoreWebView2_4, (void **)&downloads))) {
    HRESULT download_hr = ICoreWebView2_4_add_DownloadStarting(downloads, &download_object, &token); log_line(L"download-handler-registered", download_hr); ICoreWebView2_4_Release(downloads);
  }
  RECT bounds; GetClientRect(window, &bounds); ICoreWebView2Controller_put_Bounds(controller, bounds);
  ICoreWebView2Controller_put_IsVisible(controller, TRUE);
  ICoreWebView2_Navigate(webview, ORIGIN L"index.html"); ICoreWebView2Controller_MoveFocus(controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  return S_OK;
}
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl created_vtable = { created_query, created_addref, created_release, created_invoke };
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandler created_object = { &created_vtable };

CALLBACK_IUNKNOWN(environment, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)
static HRESULT STDMETHODCALLTYPE environment_invoke(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *self, HRESULT result, ICoreWebView2Environment *value) {
  (void)self;
  if (FAILED(result) || !value) { fatal(L"WebView2 初始化失败。请检查运行库是否完整、用户数据目录是否可写。", result, 23); return S_OK; }
  HRESULT hr = ICoreWebView2Environment_CreateCoreWebView2Controller(value, window, &created_object);
  if (FAILED(hr)) fatal(L"无法创建白板窗口。", hr, 24);
  return S_OK;
}
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl environment_vtable = { environment_query, environment_addref, environment_release, environment_invoke };
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler environment_object = { &environment_vtable };

static void request_close(void) {
  if (!page_ready || !webview) { DestroyWindow(window); return; }
  if (closing) return;
  closing = TRUE;
  HRESULT hr = ICoreWebView2_PostWebMessageAsString(webview, L"liubai:prepare-close");
  if (FAILED(hr)) closing = FALSE;
  else SetTimer(window, 1, 15000, NULL);
}

static LRESULT CALLBACK window_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE: if (controller) { RECT bounds; GetClientRect(hwnd, &bounds); ICoreWebView2Controller_put_Bounds(controller, bounds); } return 0;
    case WM_MOVE: if (controller) ICoreWebView2Controller_NotifyParentWindowPositionChanged(controller); return 0;
    case WM_DPICHANGED: { RECT *r = (RECT *)lp; SetWindowPos(hwnd, NULL, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE); return 0; }
    case WM_SETFOCUS: if (controller) ICoreWebView2Controller_MoveFocus(controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC); return 0;
    case WM_GETMINMAXINFO: ((MINMAXINFO *)lp)->ptMinTrackSize = (POINT){ 420, 480 }; return 0;
    case WM_CLOSE: case WM_REQUEST_CLOSE: request_close(); return 0;
    case WM_CLOSE_SAVED: KillTimer(hwnd, 1); DestroyWindow(hwnd); return 0;
    case WM_SAVE_DOWNLOAD: save_download((PendingDownload *)lp); return 0;
    case WM_TIMER:
      if (wp == 1) { KillTimer(hwnd, 1); closing = FALSE; if (!test_mode) MessageBoxW(hwnd, L"保存仍未完成，窗口已保留。请检查保存状态，必要时先导出 .inkisle 备份。", L"墨屿", MB_OK | MB_ICONINFORMATION); }
      return 0;
    case WM_DESTROY:
      if (controller) { ICoreWebView2Controller_Close(controller); ICoreWebView2Controller_Release(controller); controller = NULL; }
      if (webview) { ICoreWebView2_Release(webview); webview = NULL; }
      PostQuitMessage(exit_code); return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

/* Inherit read/execute access for AppContainer renderers. This only edits the
 * app-owned runtime tree; no system installation or elevation is involved. */
static BOOL runtime_permissions(void) {
  PSID restricted = NULL, apps = NULL; PACL old = NULL, updated = NULL; PSECURITY_DESCRIPTOR descriptor = NULL;
  DWORD result = GetNamedSecurityInfoW(runtime, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, &old, NULL, &descriptor);
  if (result != ERROR_SUCCESS) return FALSE;
  if (!ConvertStringSidToSidW(L"S-1-15-2-1", &apps) || !ConvertStringSidToSidW(L"S-1-15-2-2", &restricted)) { LocalFree(descriptor); LocalFree(apps); return FALSE; }
  EXPLICIT_ACCESSW access[2] = {0};
  for (int i = 0; i < 2; i++) {
    access[i].grfAccessPermissions = GENERIC_READ | GENERIC_EXECUTE;
    access[i].grfAccessMode = GRANT_ACCESS; access[i].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
    access[i].Trustee.TrusteeForm = TRUSTEE_IS_SID; access[i].Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
    access[i].Trustee.ptstrName = (LPWSTR)(i ? restricted : apps);
  }
  result = SetEntriesInAclW(2, access, old, &updated);
  if (result == ERROR_SUCCESS) result = SetNamedSecurityInfoW(runtime, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, updated, NULL);
  LocalFree(updated); LocalFree(descriptor); LocalFree(apps); LocalFree(restricted);
  return result == ERROR_SUCCESS;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command, int show) {
  (void)previous; (void)command;
  int argc; LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc); int port = 0; BOOL check = FALSE;
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--check") == 0) { check = TRUE; test_mode = TRUE; }
    else if (wcscmp(argv[i], L"--test-port") == 0 && i + 1 < argc) { port = _wtoi(argv[++i]); test_mode = TRUE; }
    else if (wcscmp(argv[i], L"--data-dir") == 0 && i + 1 < argc) { GetFullPathNameW(argv[++i], CAP, profile, NULL); }
    else { LocalFree(argv); return 2; }
  }
  LocalFree(argv);
  if (port && (port < 1024 || port > 65535)) return 2;
  GetModuleFileNameW(NULL, base, CAP); PathRemoveFileSpecW(base); path_join(resources, base, L"resources"); path_join(runtime, base, L"runtime");
  if (!profile[0]) { PWSTR local; if (FAILED(SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, NULL, &local))) return 10; path_join(profile, local, L"Liubai\\WebView2"); path_join(logs, local, L"Liubai\\logs"); CoTaskMemFree(local); }
  else path_join(logs, profile, L"logs");
  SHCreateDirectoryExW(NULL, profile, NULL); SHCreateDirectoryExW(NULL, logs, NULL);
  wchar_t entry[CAP]; path_join(entry, resources, L"index.html");
  if (!exists(entry)) { fatal(L"resources\\index.html 缺失，请完整解压发行包。", HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), 11); return exit_code; }
  if (INKISLE_OFFLINE) {
    const wchar_t *files[] = { L"msedgewebview2.exe", L"msedge.dll", L"icudtl.dat", L"resources.pak" };
    for (int i = 0; i < 4; i++) { path_join(entry, runtime, files[i]); if (!exists(entry)) { fatal(L"离线版 runtime 目录缺失或不完整。此版本不会回退到系统运行库。", HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), 12); return exit_code; } }
    if (!runtime_permissions()) log_line(L"runtime-permissions: cannot adjust ACL; launch will use existing permissions", HRESULT_FROM_WIN32(GetLastError()));
  }
  path_join(entry, base, L"WebView2Loader.dll"); loader = LoadLibraryExW(entry, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!loader) { fatal(L"WebView2Loader.dll 缺失或无法加载。", HRESULT_FROM_WIN32(GetLastError()), 13); return exit_code; }
  GetBrowserVersion get_version = (GetBrowserVersion)(void *)GetProcAddress(loader, "GetAvailableCoreWebView2BrowserVersionString");
  CreateEnvironment create_environment = (CreateEnvironment)(void *)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
  if (!get_version || !create_environment) { fatal(L"WebView2Loader.dll 版本无效。", E_NOINTERFACE, 13); FreeLibrary(loader); return exit_code; }
  /* Override inherited browser-path settings, so fixed builds cannot silently
   * pick up the developer's installed browser or debugging configuration. */
  SetEnvironmentVariableW(L"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", INKISLE_OFFLINE ? runtime : NULL);
  SetEnvironmentVariableW(L"WEBVIEW2_USER_DATA_FOLDER", NULL);
  SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", NULL);
  LPWSTR version = NULL; HRESULT hr = get_version(INKISLE_OFFLINE ? runtime : NULL, &version);
  if (FAILED(hr) || !version) {
    log_line(L"WebView2 runtime missing", hr);
    if (!test_mode && !INKISLE_OFFLINE) {
      int answer = MessageBoxW(NULL, L"未找到 Microsoft Edge WebView2 Runtime。\n\n轻量版需要系统 WebView2。可下载并安装后重新打开，或改用自带运行库的离线版。\n\n是否打开微软官方下载页面？", L"墨屿 · 缺少 WebView2", MB_YESNO | MB_ICONINFORMATION);
      if (answer == IDYES) ShellExecuteW(NULL, L"open", download_site, NULL, NULL, SW_SHOWNORMAL);
    } else if (!test_mode) fatal(L"随包 WebView2 运行库无法启动，请重新解压离线版。", hr, 14);
    CoTaskMemFree(version); FreeLibrary(loader); return 14;
  }
  log_line(INKISLE_OFFLINE ? L"runtime-mode=fixed" : L"runtime-mode=evergreen", S_OK); log_line(version, S_OK); CoTaskMemFree(version);
  if (check) { FreeLibrary(loader); return 0; }
  path_join(entry, profile, L"liubai.lock");
  profile_lock = CreateFileW(entry, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_HIDDEN, NULL);
  if (profile_lock == INVALID_HANDLE_VALUE) { fatal(L"另一份墨屿或旧版留白正在使用同一数据目录，请先关闭已有窗口。", HRESULT_FROM_WIN32(GetLastError()), 15); FreeLibrary(loader); return exit_code; }
  hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) { CloseHandle(profile_lock); FreeLibrary(loader); return 16; }
  wcscpy(browser_args, L"--disable-background-networking --disable-component-update --no-first-run --disable-features=msEdgeSidebarV2");
  if (port) { wchar_t debug[192]; swprintf(debug, 192, L" --enable-automation --remote-debugging-port=%d --remote-debugging-address=127.0.0.1", port); wcscat(browser_args, debug); }
  HICON large_icon = LoadImageW(instance, MAKEINTRESOURCEW(101), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_DEFAULTCOLOR);
  HICON small_icon = LoadImageW(instance, MAKEINTRESOURCEW(101), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
  SetCurrentProcessExplicitAppUserModelID(L"InkIsle.Desktop");
  WNDCLASSEXW wc = { .cbSize = sizeof wc, .lpfnWndProc = window_proc, .hInstance = instance, .lpszClassName = L"InkIsleDesktopWindow", .hCursor = LoadCursorW(NULL, IDC_ARROW), .hbrBackground = (HBRUSH)(COLOR_WINDOW + 1), .hIcon = large_icon, .hIconSm = small_icon };
  RegisterClassExW(&wc);
  window = CreateWindowExW(0, wc.lpszClassName, L"墨屿 · 正在打开", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1440, 960, NULL, NULL, instance, NULL);
  if (!window) { CloseHandle(profile_lock); CoUninitialize(); FreeLibrary(loader); return 17; }
  SendMessageW(window, WM_SETICON, ICON_BIG, (LPARAM)large_icon);
  SendMessageW(window, WM_SETICON, ICON_SMALL, (LPARAM)small_icon);
  ShowWindow(window, show); UpdateWindow(window);
  hr = create_environment(INKISLE_OFFLINE ? runtime : NULL, profile, &options_object, &environment_object);
  if (FAILED(hr)) fatal(L"无法启动 WebView2 环境。", hr, 23);
  MSG msg; while (GetMessageW(&msg, NULL, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  /* Keep the profile lock while Chromium releases the shared profile. Otherwise
   * immediately starting the other edition can attach to the previous engine. */
  if (browser_process) {
    ULONGLONG deadline = GetTickCount64() + 15000;
    while (WaitForSingleObject(browser_process, 0) == WAIT_TIMEOUT && GetTickCount64() < deadline) {
      MsgWaitForMultipleObjects(1, &browser_process, FALSE, 100, QS_ALLINPUT);
      while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    }
    CloseHandle(browser_process);
  }
  DestroyIcon(large_icon); DestroyIcon(small_icon);
  CloseHandle(profile_lock); CoUninitialize(); FreeLibrary(loader); return exit_code;
}
