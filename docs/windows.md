# Windows 发行版

当前源码版本为 **0.2.0**，Web 界面、包清单与原生资源版本已同步。本次仅更新源码与 Git 标签，不生成新的 Windows 包，也不创建 GitHub Release。下述历史包继续保留，其内容不会随源码升级。

## 已保留的留白版本

产品源码现已更名为 **墨屿 · InkIsle**。下述两个 `Liubai` 发行包是此前已生成的留白版本，按用户要求完整保留，本轮没有重新打包，也未替换其中任何文件。因此运行这些旧 EXE 仍显示“留白”，使用 `.liubai` 后缀；体验改名和侧栏更新请运行当前 Web 源码。

保留的两个 Windows 10/11 x64 绿色发行版：

| 包 | 体积（本次构建） | WebView2 | 适合场景 |
|---|---:|---|---|
| `Liubai-win-x64-lite.zip` | 223,461 bytes（约 218 KiB） | 使用系统 WebView2 | 日常分发，体积最小 |
| `Liubai-win-x64-offline.zip` | 311,578,028 bytes（约 297 MiB） | 随包 Fixed Version 155.0.4283.62 | 无网络、无预装运行库 |

轻量版的 `Liubai.exe` 为 126,976 bytes（约 124 KiB），发行目录总解压大小约 500 KB；它不带浏览器内核，目标机需要 Microsoft Edge WebView2 Runtime。缺少时会显示中文提示和官方下载页面。

离线版约 297 MB 压缩包，解压约 673 MB。它携带签名有效的固定 WebView2 内核，启动时只使用相邻的 `runtime/msedgewebview2.exe`，不会回退到系统 Edge/WebView2，也不会联网安装组件。

两个版本都不需要 Node.js、npm、.NET、VC++ Redistributable 或管理员权限。EXE、标题栏、任务栏和资源管理器显示留白 Logo；图标由 `public/favicon.svg` 自动生成 16、20、24、32、40、48、64、128、256 九个尺寸。

## 下载与启动

1. 下载对应 ZIP。
2. **完整解压**到一个普通用户有读写权限的位置。
3. 双击目录内 `Liubai.exe`。

不要只复制 EXE。离线版必须保留 `runtime/`，两个版本都必须保留 `resources/` 和 `WebView2Loader.dll`。

## 数据位置

画板数据库和 WebView2 用户数据：

```text
%LOCALAPPDATA%\Liubai\WebView2
```

启动日志：

```text
%LOCALAPPDATA%\Liubai\logs\desktop.log
```

轻量版和离线版默认共用同一数据目录，因此可以直接切换版本。程序本身不把用户画板写入发行目录；复制程序到 U 盘不会自动复制画板数据。

## 下次构建墨屿版本

后续构建脚本输出 `InkIsle-win-x64-lite/InkIsle.exe` 和 `InkIsle-win-x64-offline/InkIsle.exe` 及同名 ZIP，源文件为 `.inkisle`，导入兼容旧 `.liubai`。这些新名称产物尚未生成；此前的 `Liubai-*` 目录和 ZIP 不会被新命令清理或覆盖。

构建机要求 Windows、Node.js、MinGW-w64 GCC、`windres`、`objdump`、PowerShell 7 和 `tar`。构建脚本会固定并校验 WebView2 SDK 及离线 Runtime 的 SHA-256，生成 Vite 资源、原生 EXE、manifest 和 ZIP：

```powershell
npm run package:win:lite
npm run package:win:offline
npm run package:win
```

离线版默认下载并缓存官方 Fixed Runtime；也可指定已下载且完整的目录：

```powershell
$env:INKISLE_WEBVIEW2_RUNTIME = 'C:\path\to\fixed-runtime-x64'
npm run package:win:offline
```

未来构建使用 `release/inkisle-windows-build-summary.json` 保存包体大小、SHA-256 和原生 DLL 依赖，不覆盖旧的 `windows-build-summary.json`。各包的 `build-manifest.json` 保存所有文件哈希、Logo 尺寸、WebView2 版本和入口地址。旧 `LIUBAI_WEBVIEW2_RUNTIME` 环境变量仍作为兼容输入。

## 下次打包后的原生验证

```powershell
npm run test:windows
```

该命令以未来 `InkIsle-*` 产物为目标，生成 `inkisle-windows-verification.json`；本轮未运行。此前留白版本已经完成的验证内容包括：

- EXE/资源文件 manifest 哈希和 x64 PE 检查；
- Logo 的九档嵌入资源、资源管理器提取图标和真实窗口大小图标；
- 轻量版真实 Win32 窗口、虚拟 HTTPS 资源源、绘制和立即关闭保存；
- 离线版固定 Runtime 进程路径、断网重开、本地 Worker、`.liubai`/PNG/SVG 导出和 Win32 保存对话框；
- 两版本共享画板数据、重启恢复；
- 缺少 `resources` 或 `runtime` 时确定性失败，离线版不回退到系统运行库。

本机实测环境：Windows 11 x64（内核版本 10.0.26200）。`test:windows` 使用临时 IndexedDB profile，验证了真实窗口图标、原生保存对话框、固定内核路径、通过 CDP 断网模拟后的加载和文件操作；未在 Windows 10 或无预装运行库的干净虚拟机上执行验收。原生依赖检查只发现 Windows 系统 DLL；固定内核所需的 VC++ DLL 已随官方 runtime 一起提供，无需另装 Redistributable。
