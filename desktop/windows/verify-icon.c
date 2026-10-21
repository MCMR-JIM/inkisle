/* Build-time verification of the PE icon group, Explorer extraction and both
 * WM_GETICON handles of the actual native window. Not shipped with the app. */
#ifndef UNICODE
#define UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static HWND found;
static BOOL CALLBACK find_window(HWND hwnd, LPARAM pid) {
  DWORD owner; wchar_t name[128]; GetWindowThreadProcessId(hwnd, &owner);
  GetClassNameW(hwnd, name, 128);
  if (owner == (DWORD)pid && wcscmp(name, L"InkIsleDesktopWindow") == 0) { found = hwnd; return FALSE; }
  return TRUE;
}

static BOOL logo_pixels(HICON icon) {
  ICONINFO info;
  if (!icon || !GetIconInfo(icon, &info)) return FALSE;
  BITMAP bitmap; GetObjectW(info.hbmColor, sizeof bitmap, &bitmap);
  BITMAPINFO dib = { .bmiHeader = { .biSize = sizeof(BITMAPINFOHEADER), .biWidth = bitmap.bmWidth, .biHeight = -bitmap.bmHeight, .biPlanes = 1, .biBitCount = 32, .biCompression = BI_RGB } };
  unsigned char *pixels = calloc((size_t)bitmap.bmWidth * bitmap.bmHeight, 4);
  HDC dc = GetDC(NULL);
  BOOL ok = pixels && GetDIBits(dc, info.hbmColor, 0, bitmap.bmHeight, pixels, &dib, DIB_RGB_COLORS);
  if (ok) {
    int background = (bitmap.bmHeight / 2 * bitmap.bmWidth + bitmap.bmWidth / 8) * 4;
    int bar = (bitmap.bmHeight * 28 / 64 * bitmap.bmWidth + bitmap.bmWidth * 24 / 64) * 4;
    ok = pixels[background + 1] > pixels[background + 2] + 12 && pixels[bar] > 220 && pixels[bar + 1] > 220 && pixels[bar + 2] > 220;
  }
  ReleaseDC(NULL, dc); free(pixels); DeleteObject(info.hbmColor); DeleteObject(info.hbmMask); return ok;
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 2) return 2;
  HMODULE module = LoadLibraryExW(argv[1], NULL, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
  HRSRC group = module ? FindResourceW(module, MAKEINTRESOURCEW(101), RT_GROUP_ICON) : NULL;
  if (!group) { fwprintf(stderr, L"Missing embedded InkIsle icon group 101\n"); return 3; }
  const unsigned char *data = LockResource(LoadResource(module, group));
  const int sizes[] = { 16, 20, 24, 32, 40, 48, 64, 128, 256 };
  if (!data || data[4] != sizeof sizes / sizeof sizes[0]) return 4;
  for (unsigned int i = 0; i < sizeof sizes / sizeof sizes[0]; i++) {
    const unsigned char *entry = data + 6 + 14 * i;
    if ((entry[0] ? entry[0] : 256) != sizes[i] || (entry[1] ? entry[1] : 256) != sizes[i]) return 5;
  }
  HICON big = NULL, small = NULL;
  if (!ExtractIconExW(argv[1], 0, &big, &small, 1) || !logo_pixels(big) || !logo_pixels(small)) return 6;
  DestroyIcon(big); DestroyIcon(small); FreeLibrary(module);
  if (argc > 2) {
    EnumWindows(find_window, (LPARAM)wcstoul(argv[2], NULL, 10));
    if (!found || !logo_pixels((HICON)SendMessageW(found, WM_GETICON, ICON_BIG, 0)) || !logo_pixels((HICON)SendMessageW(found, WM_GETICON, ICON_SMALL, 0))) return 7;
  }
  printf("InkIsle logo: 9 embedded sizes, Explorer icon and window icon checks passed\n"); return 0;
}
