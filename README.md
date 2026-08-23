# LanGames-Mobile-Server

把多款**局域网联机网页游戏**整合成一个安卓**手机版服务端 APK**。打开 App 即自动启动内置的 Node.js 服务器（通过 [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) 嵌入，**零 npm 依赖**），同一局域网的任何设备用**浏览器扫码 / 输入 IP:端口**即可加入联机，并且开服务器的手机自己也能"本机打开"游玩（内嵌 WebView，强制横屏全屏）。

## 设计

- **一个 APK、多个游戏**：启动页列出当前可玩的游戏，选中后显示该游戏的局域网地址 + 二维码。
- **统一 Node 宿主**：`assets/nodejs-project/host.js` 一次性把所有已注册游戏服务器拉起（nodejs-mobile 进程内只能启动一次 Node，所以不能"选一个启一个"后再切换），每个游戏绑定独立端口。
- **目录接口**：`GET :4780/api/catalog` 返回全部可用游戏及其地址，启动页据此渲染列表。
- **每款游戏零 npm 依赖**：用纯 Node（`node:http`/WebSocket/SSE）实现服务器，APK 更小、更稳。
- **每款游戏一个目录**：`assets/nodejs-project/games/<id>/`，含 `server.cjs`（可选，支持 `createGameServer(root)`）+ 前端静态资源；无自建服务器的纯静态游戏回落通用静态服务器 `lib/static-server.cjs`。

## 目录结构

```
app/src/main/
├── assets/nodejs-project/     # 复制到 filesDir 后由 node 运行
│   ├── host.js                # 统一入口：启动全部游戏 + /api/catalog
│   ├── games.json             # 游戏注册表（id/name/port）
│   ├── lib/static-server.cjs  # 通用零依赖静态服务器（+ /api/info）
│   └── games/<id>/            # 每款游戏：server.cjs + 静态资源
├── cpp/native-lib.cpp         # JNI 桥：node::Start + stdout/stderr 重定向到 logcat
└── java/com/hanazar/langames/
    ├── LanGame.java           # 游戏注册信息
    ├── NodeService.java       # 前台服务：复制 assets + 启动 host.js
    ├── MainActivity.java      # 启动页：游戏选择器 + 状态/地址/二维码
    └── GameActivity.java      # 内嵌 WebView 本机游玩（强制横屏全屏）
app/libnode/                   # libnode.so + 头文件（CI 下载，不入库）
```

## 游戏接入进度

| 游戏 | 端口 | 服务器 | 状态 |
|---|---|---|---|
| 掼蛋 | 4173 | HTTP + SSE 房间管理 | ✅ 已接入（逆时针出牌 + 进贡/还贡/抗贡） |
| 斗地主 | 4174 | WebSocket（零依赖） | ✅ 已接入 |
| 骗子酒馆 | 4175 | WebSocket（零依赖） | ✅ 已接入 |

> 只有注册进 `games.json` 且目录就绪的游戏才会被 `host.js` 启动、才会显示在启动页。

## 构建

GitHub Actions 自动构建（push / workflow_dispatch），本机无需 Android SDK：

```bash
git push origin main
```

Workflow 会：安装 JDK 17 + Android SDK + NDK 26 + CMake → 从 nodejs-mobile release 拉取 `libnode.so`（arm64-v8a）与头文件 → `assembleDebug` + `assembleRelease` → 自签 release APK 并上传 artifact。

## 使用

1. 安装 APK，打开后等待状态变为"服务器运行中"。
2. 选择一款游戏，看到该游戏的局域网地址 + 二维码。
3. 其他设备同 WiFi 下扫码，或浏览器打开 `http://<手机IP>:<端口>`。
4. 一人创建房间，其余输入房间码加入。
