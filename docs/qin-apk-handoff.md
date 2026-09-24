# 自用 Android 安装包交接（qin）

2026-09-23 已确认采用 Android 系统容器，不再要求 DCloud 账号、离线 AppKey 或 HBuilderX。安装包可以自行签名；签名密钥由 **qin** 保管，后续同签名更新须复用对应密钥，仓库和安装包不包含密钥及密码。

- 原生工程：`android/`。本次在 Windows 使用 JDK 17、Android SDK 36 和 Gradle 9.5；先运行 `npm run build:web`，设置 `PINDOU_SIGNING_FILE` 为下述 Windows 私有配置文件路径，再运行 `gradle -p android --no-daemon assembleRelease`。[Linux 构建记录](linux-android-build.md)保留供历史追溯。
- 页面和账本：`app/`；正式账本规则仍以 `app/src/ledger/operations.ts` 为真源。
- 应用包名：`com.pindou.ledger`；本次自用版 `0.2.1`（versionCode 201）；备份格式 v2。独立验收包名为 `com.pindou.ledger.debug`。
- 输出：`android/app/build/outputs/apk/release/app-release.apk`；本次 Windows 自用交付文件为 `artifacts/pindou-0.2.1-release.apk`（21,964,155 字节，SHA-256 `180C4635511DBB8F2EB979709F18451E06C1A6A2AC11F823F897F167F9900777`，仅本机保存）。后续更新沿用同包名及本次新密钥，并提高 `versionCode`。

2026-09-25 按用户要求在 Windows 重新生成自用签名。新密钥与构建配置位于 `%LOCALAPPDATA%\pindou-calculate\signing\`，其中 `douji-release-2026.p12` 和 `signing.properties` 只允许当前 Windows 用户、SYSTEM 和管理员访问；构建时把后者路径设为 `PINDOU_SIGNING_FILE`。请由 qin 另行安全备份这两个文件，密码、私钥不可放入 Git、APK 或公开分发附件。旧 0.2.0 APK 的证书 SHA-256 为 `3caa2296a6734eba842491c452d3a62528cff265231fdd1f293799135bc049ca`；本次 0.2.1 为 `9c71f32a3dbaa37dbe515eaa8a21160c5f361f99bb55637385dba1621af2a1e2`，**不能覆盖安装旧版**。旧 Linux 签名文件仍属于历史 0.2.0 包，不用于本次或后续新包。

若手机已安装旧版，先在旧版导出备份，并在手机文件管理器确认备份文件存在且可读取；再卸载旧版、安装 0.2.1、在设置中选择备份恢复并核对库存与图纸。卸载会删除旧应用的私有数据；没有完成备份核对时不要卸载。

账本通过 Android SQLite 事务保存，原生提交成功后页面才显示成功。读取失败或数据格式损坏会显示错误、保留原库，不转成可编辑的空白账本。当前备份包括库存、图纸缩略图、用量来源/风险和制作记录，原始大图不进入备份。

旧 DCloud 基座和独立应用是不同应用，不能直接读取彼此的私有存储。需要保留基座中的数据时，先在旧应用设置页导出当前备份，再在新应用设置页选择并确认恢复；核对完成后再处理旧应用。验收不会自动替用户导入或覆盖个人数据。

自用无需上架或公开发布。手机若拒绝电脑安装，可在手机文件管理器中打开下载目录内的 APK 安装；这一步取决于手机的安装权限。实际安装、覆盖更新和完整闭环是否通过，以 [本次验收](acceptance/issues13-14/README.md) 为准。
