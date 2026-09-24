# 自用 Android 安装包交接（qin）

2026-09-23 已确认采用 Android 系统容器，不再要求 DCloud 账号、离线 AppKey 或 HBuilderX。安装包可以自行签名；签名密钥由 **qin** 保管，用于后续覆盖更新，仓库和安装包不包含密钥及密码。

- 原生工程：`android/`，构建步骤见 [Linux 构建](linux-android-build.md)。
- 页面和账本：`app/`；正式账本规则仍以 `app/src/ledger/operations.ts` 为真源。
- 应用包名：`com.pindou.ledger`；本次自用版 `0.2.1`（versionCode 201）；备份格式 v2。独立验收包名为 `com.pindou.ledger.debug`。
- 输出：`android/app/build/outputs/apk/release/app-release.apk`。后续更新沿用同包名和密钥，并提高 `versionCode`；不要先卸载应用。

本机签名文件位置为 `/home/kenbattle/.local/share/pindou-calculate/signing/`，内含 `douji-release.p12` 与私有 `signing.properties`，仅当前系统用户可读。请由 qin 在私人存储中保留这两个文件；不可放入 Git、APK 或公开分发附件。重新生成不同密钥将无法直接覆盖更新现有安装。

账本通过 Android SQLite 事务保存，原生提交成功后页面才显示成功。读取失败或数据格式损坏会显示错误、保留原库，不转成可编辑的空白账本。当前备份包括库存、图纸缩略图、用量来源/风险和制作记录，原始大图不进入备份。

旧 DCloud 基座和独立应用是不同应用，不能直接读取彼此的私有存储。需要保留基座中的数据时，先在旧应用设置页导出当前备份，再在新应用设置页选择并确认恢复；核对完成后再处理旧应用。验收不会自动替用户导入或覆盖个人数据。

自用无需上架或公开发布。手机若拒绝电脑安装，可在手机文件管理器中打开下载目录内的 APK 安装；这一步取决于手机的安装权限。实际安装、覆盖更新和完整闭环是否通过，以 [本次验收](acceptance/issues13-14/README.md) 为准。
