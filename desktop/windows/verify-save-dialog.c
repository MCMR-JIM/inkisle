/* Test-only driver for the ordinary Win32 Save As dialog (not shipped). */
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <wchar.h>
#include <stdlib.h>
#include <stdio.h>

static HWND dialog;
static HWND filename;
static BOOL CALLBACK find_dialog(HWND hwnd, LPARAM process) {
  DWORD pid; wchar_t name[64]; GetWindowThreadProcessId(hwnd, &pid); GetClassNameW(hwnd, name, 64);
  if (pid == (DWORD)process && IsWindowVisible(hwnd) && wcscmp(name, L"#32770") == 0) { dialog = hwnd; return FALSE; }
  return TRUE;
}
static BOOL CALLBACK inspect_child(HWND hwnd, LPARAM unused) {
  (void)unused; wchar_t name[128], text[256]; GetClassNameW(hwnd, name, 128); GetWindowTextW(hwnd, text, 256);
  fwprintf(stderr, L"child id=0x%x class=%ls text=%ls\n", GetDlgCtrlID(hwnd), name, text); return TRUE;
}
static BOOL CALLBACK find_filename(HWND hwnd, LPARAM unused) {
  (void)unused; wchar_t name[64]; GetClassNameW(hwnd, name, 64);
  if (GetDlgCtrlID(hwnd) == 1001 && wcscmp(name, L"Edit") == 0) { filename = hwnd; return FALSE; }
  return TRUE;
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 3) return 2;
  DWORD pid = wcstoul(argv[1], NULL, 10); ULONGLONG deadline = GetTickCount64() + 20000;
  while (!dialog && GetTickCount64() < deadline) { EnumWindows(find_dialog, pid); if (!dialog) Sleep(50); }
  if (!dialog) return 3;
  // Explorer-style OPENFILENAME: cmb13 hosts the file name edit. The classic
  // form has edt1 directly. No viewport coordinates or locale-specific labels.
  HWND field = NULL;
  // The dialog exists before the shell finishes creating its file-name edit.
  while (!field && IsWindow(dialog) && GetTickCount64() < deadline) {
    field = GetDlgItem(dialog, 0x047c);
    if (field) field = FindWindowExW(field, NULL, L"Edit", NULL);
    if (!field) field = GetDlgItem(dialog, 0x0480);
    if (!field) { EnumChildWindows(dialog, find_filename, 0); field = filename; }
    if (!field) Sleep(50);
  }
  if (!field) { wchar_t text[256]; GetWindowTextW(dialog, text, 256); fwprintf(stderr, L"No filename field in: %ls\n", text); EnumChildWindows(dialog, inspect_child, 0); return 4; }
  if (!SendMessageW(field, WM_SETTEXT, 0, (LPARAM)argv[2])) return 5;
  PostMessageW(dialog, WM_COMMAND, IDOK, 0);
  while (IsWindow(dialog) && GetTickCount64() < deadline) Sleep(50);
  return IsWindow(dialog) ? 6 : 0;
}
