# Linux Android 构建与真机测试

2026-09-22：用户允许自行选择 Android 构建工具，不要求 HBuilderX 或 Windows。

## 已验证的资源构建

在仓库根目录运行：

```sh
npm ci
npm run build:app
```

输出为 `dist/build/app/`，包含 `app-service.js`、视图资源及 Android 运行时使用的 `manifest.json`。它是应用资源，尚不是 APK。`app/` 仍可直接由 HBuilderX 打开。

本次环境是 Ubuntu 24.04 ARM64、Node 24.19.0，官方 uni-app 编译器版本为 `3.0.0-5020620260917001`（5.26）。根目录构建实测成功，加入依赖后 79 项既有应用测试全部通过。版本由 `package-lock.json` 锁定。新版编译器默认开启的 uni 统计已在 `app/manifest.json` 显式关闭。

## Android 工具与运行库

临时目录中已实际启动 ARM64 JDK 17、Gradle 8.14.3 / Android Gradle Plugin 8.12.0，并准备 Android 36 平台。Linux build-tools 36.0.0 的 aapt2 是 x64 可执行文件，本次通过 QEMU 验证其可运行。没有改变系统 Java 或安装常驻服务。

官方 HBuilderX Linux CLI 包是 x64；在这台 ARM64 主机直接运行返回 `Exec format error`。这不等于 Linux 不能编译 Android，也不等于已经证明完整 HBuilderX 无法通过兼容层运行。[官方 Linux CLI](https://hx.dcloud.net.cn/Tutorial/install/linux-cli)、[社区 ARM / amd64 反馈](https://github.com/haixeefrontend/hbuilderx-docker/issues/1)。本项目已通过原生 Node CLI 完成资源构建，无需启动 HBuilderX。

为验证原有 HTML5+ 文件、图片和存储能力，已从官方 HBuilderX 5.26 Linux 压缩包提取标准基座 `plugins/launcher/base/android_base.apk`。包名为 `io.dcloud.HBuilder`，版本 15.26，含 arm64-v8a，targetSdk 28；原始官方 APK 未修改。标准基座可加载 uni-app 动态资源，使用 DCloud 的包名和签名。[官方基座说明](https://uniapp.dcloud.io/tutorial/run/run-app.html)

## 当前真机边界

小米 14 Ultra（Android 15）已授权 USB 调试。USB 安装被手机拒绝：`INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`，用户开启小米“USB 安装”时遇到 SIM 卡要求。随后已通过系统 mDNS（`avahi-browse`）发现同一手机、使用用户提供的配对码成功建立 Wi-Fi 调试连接；本机 `adb mdns services` 未显示设备，不能据此判断手机未开启无线调试。

Wi-Fi 连接下再次安装仍返回相同限制，说明更换连接方式没有解决本机安装限制。官方 APK 已成功传入手机 `Download/pindou-test-20260922/HBuilder-5.26.apk`（96,061,408 字节），随后已通过手机本地安装，并确认 `io.dcloud.HBuilder` 存在。

仅复制资源并启动 `PandoraEntry` 时仍显示基座等待页；复用官方 launcher 的 `PushResources` 同步接口后，豆计首页实际显示成功。同步进程在临时目录运行，HTTP 与 WebSocket 只监听回环地址，经 `adb reverse` 提供资源；停止时移除本次端口转发。标准基座及 APK 未修改，未启动 HBuilderX 主程序。手机限制 shell 模拟点击，但可通过豆计自身的 WebView 调试通道验证页面。

用户随后要求优先处理 UI，功能验收已暂停。首页视觉、色组筛选和搜索的真机结果见 [UI 调整记录](acceptance/ui-20260922/README.md)。持久化、文件、分享及备份恢复仍未完成 Android 验收。

标准基座验证不能替代正式包名 `com.pindou.ledger` 的签名安装包、目标 SDK 差异或覆盖升级验收。正式签名密钥由 qin 保管；不使用标准基座的签名冒充正式签名。

如采用 DCloud 离线 SDK 制作正式 APK，官方 3.1.10 起要求配置绑定应用与签名的 AppKey。本次官方 SDK 下载页的网盘链路要求图形验证码，未取得 SDK；没有上传源码、签名材料或创建云打包任务。[离线 SDK 接入](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/android)

本次构建配置及证据由主会话自行复核，未做独立 QA。
