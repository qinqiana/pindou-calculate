# 安卓打包交接（qin）

本机 Linux 无法产出签名 APK。打包、签名与真机安装由 **qin** 负责。仓库不含密钥、keystore 或个人配置。

## 源码位置

- uni-app 工程根：`app/`（`manifest.json`、`pages.json`、`pages/`、`src/ledger/`）
- 账本真源：`app/src/ledger/operations.ts` 的 `Ledger`
- 应用标识：`appid` `__UNI__PINDOU01`；Android 包名 `com.pindou.ledger`；版本 `0.1.0`

## Linux 本机结论

无 Android SDK、无 HBuilderX、Java 8 only、无已连接设备，因此不在本机出包。探测见实施记录中的 `apk-build.log`。

## qin 负责

Windows HBuilderX 打开 `app/`，签名密钥由 qin 保管。真机验收：无账号录入 A1=100 重开仍在；95 颗补货后已拼 A1=20、B1=0。
