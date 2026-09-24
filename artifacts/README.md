# 豆计自用 Release APK

## 0.2.1（2026-09-25）

[下载 pindou-0.2.1-release.apk](pindou-0.2.1-release.apk)（21,964,155 字节，SHA-256 `180C4635511DBB8F2EB979709F18451E06C1A6A2AC11F823F897F167F9900777`）。包名 `com.pindou.ledger`，versionCode 201，最低 Android 10；Windows 新密钥自签，APK v2 签名校验通过。证书 SHA-256 为 `9c71f32a3dbaa37dbe515eaa8a21160c5f361f99bb55637385dba1621af2a1e2`，安装包不含私钥、密码或个人账本。

**新签名不能覆盖安装下方的 0.2.0 包。** 已安装旧版时，先导出并核对备份文件，再卸载旧版、安装 0.2.1 并恢复；卸载会删除旧应用的私有数据。本包已完成构建、签名和静态校验，尚无连接的 Android 设备供真机安装验收。密钥保管和迁移步骤见[交接说明](../docs/qin-apk-handoff.md)。

## 0.2.0（历史包）

[下载 pindou-0.2.0-release.apk](pindou-0.2.0-release.apk)（21,961,271 字节，约 21 MiB）。包名 `com.pindou.ledger`，版本号 200，最低 Android 10；由本机专用密钥自签，APK v2 签名校验通过，不包含密钥、密码或个人账本。

**整合分支提示（2026-09-24）：**此 APK 是整合前的旧包，不包含本次批量补货预览、备份恢复防覆盖及 Windows 构建脚本修复。不能用它验收整合分支；须从整合后的源码重新构建、签名并在真机复验。

应用使用系统 WebView、SQLite、文件选择器和 MediaStore，无网络权限或 DCloud 手机运行库/AppKey。现有 Vue/uni-app 页面和离线识别依赖随包保留，没有新增容器 SDK。

与此旧包相同源码的独立 debug 包已在 Xiaomi 14 Ultra / Android 15 完成启动、SQLite 重启读取、媒体接口输出及 N25 图纸 11 色 325 颗识别确认。此 Release 包尚未装机复验，同签名覆盖更新、系统选图及完整备份恢复/分享复验仍待完成；详见 [验收记录](../docs/acceptance/issues13-14/README.md)。这是开发阶段自用包，未合并 PR 或上架发行。

旧 DCloud 基座与本包属于不同数据区，保留旧账需要导出当前备份后在新应用恢复。签名保管和后续构建见 [交接说明](../docs/qin-apk-handoff.md)。
