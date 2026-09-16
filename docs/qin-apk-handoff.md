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

## PR2 返修后的持久化与文件能力（待真机复核）

- 持久化改为 `app/src/platform/app-ledger.ts` 的 `PlusSqliteSink` 直写真实 SQLite：构造期建表，`read()` 走 SELECT 同步捕获，`write()` 走 `transaction('begin')` → DELETE+INSERT → `transaction('commit')`，任一步失败或未确认即 rollback 并抛 `PersistError`。**前提假设：plus.sqlite 在 5+ 环境为同步桥接（回调同步触发）；官方文档未明示，若真机表现为异步回调，代码按「未确认」失败处理（fail-closed，报错但不伪成功），需复核确认。**
- 启动读取失败不再空账覆盖：`BootReadError` 置位后 `appLedger()` 返回降级账本（写入即报 persist-failed），三个 tab 页有存储错误横幅 + `retryAppStorage()` 重试。
- 文件能力集中在 `app/src/platform/fs.ts`：系统文档选择器读图纸/备份（`pickImageFile` / `pickTextDocument`）、`writeTextToDownloads` 写公共下载目录、`saveImageToGallery` 入相册。**系统选择器、作用域存储（Android 10+）、相册可见性均待真机复核。**
- 真机闭环验收清单（即审阅出口）：录入 → 杀进程重开数据仍在 → 导入图纸 → 已拼/撤回 → 导出备份并能从下载目录取出 → 恢复备份 → 分享图入相册可见。
