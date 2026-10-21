# 留白 Windows 双发行版设计

## 目标

为现有留白白板提供两种可在 Windows 10/11 上直接运行的发行包：

1. **轻量版**：体积优先，使用目标机已安装的 WebView2 Runtime。
2. **离线绿色版**：不要求目标机预装 WebView2、Node.js、.NET 或 Visual C++ Redistributable，随包携带 Fixed Version WebView2 Runtime，完全离线启动。

两种发行版共用同一份 `dist/` 前端资源、白板功能、本地 IndexedDB 数据和 `.liubai` 文件格式。

## 已确认的边界

- Windows 目标架构首期为 **x64**；不在首期同时发布 x86/ARM64。
- 外壳为原生 Win32 GUI，不使用 Electron、Node.js Runtime 或 .NET Runtime。
- 原生外壳使用 Windows 系统 API 与 WebView2 C ABI；WebView2 Loader 静态链接或随应用携带。
- 轻量版不捆绑浏览器内核。缺少 WebView2 时不静默失败，显示中文说明和官方下载入口。
- 离线版不联网、不执行运行时下载；启动时只从相邻 `runtime/` 目录加载 Fixed Version Runtime。
- 应用资源以旁置 `resources/` 目录发布，首期不把整份前端资源强行压入单个 EXE，以保持构建简单、更新可替换和故障可诊断。
- 本地数据仍由 Chromium/WebView2 的 IndexedDB 管理；升级应用不得主动清理现有数据。
- 发行包包含版本、架构和 Runtime 模式信息，启动器在错误目录结构或错误架构时给出可读错误。

## 发行包布局

```text
release/
  Liubai-win-x64-lite/
    Liubai.exe
    resources/
      index.html
      assets/
      *.worker-*.js
    README.txt
  Liubai-win-x64-offline/
    Liubai.exe
    resources/
      index.html
      assets/
      *.worker-*.js
    runtime/
      msedgewebview2.exe
      ... Fixed Version Runtime files ...
    README.txt
```

`Liubai.exe` 的资源目录以自身所在目录为基准，不依赖当前命令行目录。通过 WebView2 本地映射加载固定入口 `https://liubai.localhost/index.html`，无需 HTTP 服务器；Worker、图片和 Blob 下载在两种模式下均可用。

## 原生外壳

新增 `desktop/windows/` 原生项目，职责保持单一：

- 创建高 DPI 感知的顶层窗口和 WebView2 控件。
- 解析自身目录下的 `resources/`。
- 轻量模式调用系统 WebView2 Runtime 检测；缺少时显示错误页，不启动半残应用。
- 离线模式把 `runtime/` 传给 `CreateCoreWebView2EnvironmentWithOptions` 的 `browserExecutableFolder`。
- 将窗口大小、关闭、最小化、最大化和系统菜单交给 Win32；白板绘制、文件格式和本地存储仍由前端负责。
- 只允许导航到本地应用资源；外部链接在默认浏览器打开，避免 WebView 内加载不受控页面。

原生层不实现第二套白板业务逻辑。若需要打开 `.liubai` 文件，首期仍通过前端导入入口完成，避免原生和 Web 层产生两个解析器。

## WebView2 Runtime 策略

### 轻量版

- 启动前检测系统 WebView2 Runtime。
- 找不到 Runtime 时显示原生中文对话框，说明可安装系统 WebView2 或改用离线版；用户可选择打开官方下载页面，安装后重新运行。
- 不自动下载、不修改系统、不要求管理员权限。
- WebView2 版本由系统维护，应用只依赖已验证的 Web 平台能力。

### 离线版

- 固定使用 `runtime/` 目录，不读取系统 Edge 或 Evergreen Runtime。
- 打包脚本要求 Runtime 目录存在且包含目标架构的 `msedgewebview2.exe`。
- 启动前检查目录、版本标记和关键文件；不完整时显示修复提示并退出。
- Windows 10 Fixed Version 的 AppContainer 文件权限按 Microsoft WebView2 分发要求处理。
- Runtime 更新由后续发行包替换，不由应用联网更新。

Fixed Version Runtime 体积预期超过 250MB；这是离线可运行的浏览器内核成本，不能通过删除 DLL 来压缩而保持可靠运行。

## 构建命令

新增可在 PowerShell 中使用的 Node.js 构建入口（仅构建机需要 Node.js）：

```powershell
npm run package:win:lite
npm run package:win:offline
```

两个命令都按以下顺序执行：

1. 清理对应 `release/` 输出目录。
2. 执行前端生产构建。
3. 编译 x64 原生 Win32 外壳。
4. 复制 `dist/` 到 `resources/`。
5. 写入 `build-manifest.json`，记录应用版本、架构、Runtime 模式和资源哈希。
6. 生成 `README.txt`，说明启动方式、数据位置、版本和故障处理。
7. 做静态依赖检查和包结构检查。

离线命令默认从微软官方地址下载固定版本，按已记录 SHA-256 校验并缓存；也支持环境变量指定完整的 Fixed Runtime 目录：

```powershell
$env:LIUBAI_WEBVIEW2_RUNTIME = 'C:\path\to\fixed-runtime-x64'
npm run package:win:offline
```

下载失败、校验失败或指定目录不完整时必须构建失败，禁止生成一个实际不能离线运行的伪离线包。发行程序本身不下载运行库。

## 数据与升级

- 继续使用当前 `liubai-local-v1` IndexedDB 数据库名和版本协议。
- 不把数据放到程序目录；WebView2 User Data Folder 放在用户本地应用数据目录，例如 `%LOCALAPPDATA%\Liubai\WebView2`，避免程序目录无写权限导致保存失败。
- 两种发行版默认使用同一应用数据目录，方便用户从轻量版切换离线版；未来若需要并存，再提供明确的 profile 参数。
- `.liubai` 导入导出仍由前端负责，原生层只提供资源和窗口能力。

## 安全与故障处理

- 不允许原生外壳从任意外部 URL 导航。
- 资源目录缺失、WebView2 缺失、Runtime 架构不匹配、Fixed Runtime 不完整、创建环境失败，都显示确定的中文错误信息。
- 轻量版错误页提供 WebView2 官方下载地址；离线版错误页不尝试联网。
- 打包脚本检查 EXE 和资源架构均为 x64；发布前检查 Runtime 目录不包含开发机绝对路径。
- 原生外壳的错误信息写入 `%LOCALAPPDATA%\Liubai\logs`，不记录画板内容。

## 验收标准

### 轻量版

- 在安装了 WebView2 的 Windows 10/11 x64 机器上双击即可打开示例画板。
- 不安装 Node.js、npm、.NET 或 VC++ Redistributable。
- 本地保存、刷新恢复、`.liubai` 导入导出、PNG/SVG 导出、Worker 和 Canvas 取色正常。
- 在无 WebView2 的测试环境显示可操作错误页，不崩溃、不白屏。

### 离线版

- 在无网络、无预装 WebView2、无 Node.js/.NET/VC++ 的 Windows 10/11 x64 环境下双击即可打开。
- 断网后仍可创建、保存、重启恢复、导入导出和使用 Worker。
- 只从随包 `runtime/` 启动，删除或改名 Runtime 后能显示明确错误。
- 程序目录复制到另一个路径后仍可运行；用户数据不写入程序目录。

### 工程验证

- `npm test`、`npm run build`、`npm run test:e2e`、`npm run test:production` 继续通过。
- 新增包结构、manifest、缺少 Runtime、资源路径、轻量/离线模式的原生启动测试。
- 在真实 Windows 10/11 x64 环境各执行一次启动、保存、重启和文件往返测试；CI 若无 Windows 原生环境，不以模拟浏览器测试替代该验收。

本次已完成 Windows 11 x64 原生窗口和文件往返验证；Windows 10 及干净系统验收尚未执行，见 `docs/windows.md`。

## 取舍

选择原生 Win32 + WebView2 而不是 Electron，是为了避免 Node.js/Chromium/Node 原生模块的额外体积和运行时层。选择旁置资源而不是单文件嵌入，是为了让 Fixed Runtime、Worker 和前端资源能独立校验与更新。离线绿色版体积较大是固定浏览器内核的必要成本；轻量版承担日常小体积分发需求。
