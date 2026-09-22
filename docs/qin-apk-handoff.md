# 安卓打包交接（qin）

Linux 可以构建 Android；不再要求由 Windows HBuilderX 完成。2026-09-22 已在 ARM64 Linux 上使用官方 Node CLI 编译本项目的 Android 资源，正式签名密钥仍由 **qin** 保管。仓库不含密钥、keystore 或个人配置。

## 源码位置

- uni-app 工程根：`app/`（`manifest.json`、`pages.json`、`pages/`、`src/ledger/`）
- 账本真源：`app/src/ledger/operations.ts` 的 `Ledger`
- 应用标识：`appid` `__UNI__1B6F1EF`；Android 包名 `com.pindou.ledger`；版本 `0.1.3`（`versionCode` 102）

## Linux 本机结论

旧实施记录中的“无 SDK、Java 8、无设备”是当时的环境探测，不能推出 Linux 无法打包。当前已在临时目录验证 ARM64 JDK 17、Gradle 8.14.3、Android 36 工具链；x64 aapt2 通过 QEMU 运行。小米 14 Ultra（Android 15）已通过 USB 调试授权。`npm ci && npm run build:app` 输出 `dist/build/app/`，这是 Android 应用资源，不是 APK。

## qin 负责

签名密钥由 qin 保管；主会话负责选择构建工具并执行真机验证。使用标准调试基座运行时，其包名和签名属于 DCloud，不能替代 `com.pindou.ledger` 正式签名安装包或覆盖升级验收。真机验收：无账号录入 A1=100 重开仍在；95 颗补货后已拼 A1=20、B1=0。

## PR2 返修后的持久化与文件能力（待真机复核）

- `plus.sqlite` 的官方接口通过回调返回结果，不能被同步账本接口直接读取。因此 Android App 运行时使用 `app/src/platform/app-ledger.ts` 的 `PlusStorageSink`，将完整 envelope 一次写入同步本地存储 key；仍保持“先落盘、后改可见状态”，写入失败不会伪成功。同步回调的 `PlusSqliteSink` 和 `SqliteJsonStore` 保留给测试/兼容环境，不作为标准 App 运行时路径。
- 首次启动若新本地存储没有账本，会异步读取同一 appid/包名下旧 SQLite 的 `pindou_ledger`，校验后写入新存储并回读确认；旧 SQLite 不删除。迁移失败时不显示空账本，也不覆盖旧数据。测试升级迁移时必须覆盖安装，不能先卸载应用。
- 启动读取失败不再空账覆盖：`BootReadError` 置位后 `appLedger()` 返回降级账本（写入即报 persist-failed），三个 tab 页有存储错误横幅 + `retryAppStorage()` 重试。
- 文件能力集中在 `app/src/platform/fs.ts`：系统文档选择器读图纸/备份（`pickImageFile` / `pickTextDocument`）、`writeTextToDownloads` 写公共下载目录、`saveImageToGallery` 入相册。**系统选择器、作用域存储（Android 10+）、相册可见性均待真机复核。**
- 真机闭环验收清单（即审阅出口）：录入 → 杀进程重开数据仍在 → 导入图纸 → 已拼/撤回 → 导出备份并能从下载目录取出 → 恢复备份 → 分享图入相册可见。
- 升级验收还需覆盖：同一包名从旧 SQLite 账本覆盖安装到 0.1.3 后，库存、图纸和历史仍可读；若旧版本使用过不同 appid，系统沙盒隔离时改用备份恢复。
