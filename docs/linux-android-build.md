# Linux 构建独立 Android 安装包

2026-09-23 用户确认使用 Android 本身，尽量不增加第三方依赖。当前入口是 `android/` 的 Java 工程：系统 WebView 显示随包页面，系统 SQLite 保存账本，系统文档选择器读取原图和备份，MediaStore 保存下载文件与分享图。不依赖 DCloud 手机运行库、离线 AppKey、云打包或容器 SDK；现有 Vue/uni-app H5 编译工具及本地识别依赖继续复用。

已有工具：Node 24、JDK 17、Gradle 8.14.3、Android Gradle Plugin 8.12.0、Android SDK / build-tools 36。Android 最低版本设为 10（API 29），使用其无需广泛存储权限的 MediaStore 输出；实际机型覆盖以验收记录为准。没有为应用申请网络权限，资源只由固定本地来源载入。

```sh
npm ci
npm test
npm run build:web
# JAVA_HOME、ANDROID_HOME、PATH 指向本机已有 JDK、SDK、Gradle
export PINDOU_SIGNING_FILE=/absolute/private/path/signing.properties
gradle -p android --no-daemon assembleRelease
```

页面输出 `dist/build/android-assets/`；自用签名 APK 输出 `android/app/build/outputs/apk/release/app-release.apk`。签名配置缺失时正式构建报错，不交付未签 APK。验收可用 `assembleDebug` 生成独立包名 `com.pindou.ledger.debug`，正式包名为 `com.pindou.ledger`；正式包关闭 WebView 调试。

签名配置放仓库外且仅保管人可读，内容为 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` 四项。包、仓库和日志都不应包含密钥或密码。签名保管及更新说明见 [交接](qin-apk-handoff.md)。

本次 ARM64 Linux 主机沿用任务目录中准备好的官方 x64 aapt2 及 QEMU 包装器，通过 `-Pandroid.aapt2FromMavenOverride=/absolute/path/aapt2` 指定；包装器文件名必须为 `aapt2`。这是主机打包工具的适配，不会进入手机安装包。Gradle 使用 `--no-daemon`；没有部署服务器或常驻服务。

打包结果不替代真机验证。完整证据、所用包类型、手机限制及尚未完成的验收见 [#13–#14](acceptance/issues13-14/README.md)。旧 DCloud 标准基座验收保留在历史记录中，不能冒充新容器结果。
