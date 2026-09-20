# #7 WebP 原图导入与保存恢复

2026-09-20。范围依据 [Issue #7](https://github.com/qinqiana/pindou-calculate/issues/7)、[根规格](../../../SPEC.md)和[识图专项](../../specs/image-recognition.md)。用户在本任务明确确认「T22–T27 已完成，可继续」，解除 G0 阶段前置条件。本次完成代码及本地验证；#7 保留开放，待本次更新的 Android 真机验收。

## 实现

- Android 系统文档选择器读取所选文件原始字节，不经过相册压缩；读取中限制 20 MiB。按内容校验 PNG/JPEG/WebP，WebP 检查完整 RIFF/chunk、静态标志和尺寸；超过 3200 万像素及动画被拒绝。
- Android 9+ 使用 `ImageDecoder` 完整解码，不接受部分图像；Android 5–8 使用系统 `BitmapFactory`，保留现有最低系统版本。解码后再次核对尺寸，修正 EXIF 方向，透明缩略图以白底合成。原图保持原始字节。
- 图纸列表先完成解码和预览，再允许确认导入。编辑页保留原图、支持原页放大查看；退出编辑或确认成功后释放内存中的原图。不生成原图临时文件，也不删除用户所选文件。
- 取消重选、读文件、解码、缩略图转换和写入失败保留已有输入，迟到的选图结果不能恢复已取消的预览。备份恢复后旧编辑会话不能写回。
- 原有 `Ledger` 是唯一业务入口，只注入平台缩略图函数；保存的仍是 PNG 缩略图及既有字段。备份格式维持 1，分享与恢复无需 WebP 解码器。未加入自动识图。

依据：[WebP 容器规范](https://developers.google.com/speed/webp/docs/riff_container)、[Android ImageDecoder](https://developer.android.com/reference/android/graphics/ImageDecoder)、[BitmapFactory](https://developer.android.com/reference/android/graphics/BitmapFactory)、[HTML5+ Native.js](https://www.html5plus.org/doc/zh_cn/android.html)。

## 已取得的证据

环境：Linux aarch64，Node 24.19.0，Python 3.12.3，Pillow 10.2.0 / libwebp 1.3.2。无新增运行依赖。

运行：

```sh
node --experimental-strip-types --test --test-isolation=none tests/*.test.ts app/src/share/share.test.ts
```

75 项通过。初次受限沙箱运行时，已有 T28 测试因 Node 子进程权限报告 `EPERM`；允许本机子进程后整套通过，没有修改该实验。预览保护改动后页面和文件定向测试 19 项通过，最终图片、账本与页面定向回归 28 项通过。

| 对应验收 | 本机结果 | 证据边界 |
| --- | --- | --- |
| R01/R15 | 仓内原始 1 PNG、4 JPG、13 WebP 全部完整解码，生成非空且比例正确的 PNG 缩略图；手工确认前后库存不变 | 实际像素解码采用本机 Pillow/libwebp，Android 桥接用测试替身；不是手机选图证据 |
| R02/R03 | 有损、无损、透明、EXIF 旋转静态 WebP 通过；透明空区白底、旋转后宽高正确 | 合成编码样例来源见 [fixtures](../../../tests/fixtures/webp/README.md)；旧系统旋转及 WebView 显示方向待设备验证 |
| R02/R20 | 动画、坏长度、坏 chunk、截断、坏压缩数据、超字节/超像素拒绝；账本保持前态 | 不声称枚举了全部损坏方式 |
| R15 | 文件账本重开及 v1 备份替换恢复后，图纸、用量、余额、制作快照和流水一致；18 张图均能进入现有分享渲染 | 系统下载目录和相册保存待设备验证 |
| R20 | 实际 Vue 页面处理函数验证取消、读取失败、保存失败、迟到响应、放大返回、恢复后旧页面保护与原图释放 | 未运行 Android 页面布局/触控 |

主会话亲自查看了 [13 张 WebP 缩略图](webp-thumbnails.png)和本机生成的 1080×1800 分享图：图纸形状、方向和比例可辨认，无空白替代图。缩略图用于辨认，不能用于逐格读色号。分享沿用原模板，未提供作品照片时作品区域仍为空。

代码自行复核，未做独立 QA：当前未取得符合模型级别边界且允许承担 QA 的独立模型声明。检查范围为本次差异、调用方和上述证据。

## Android 待验收

本次 `adb devices -l` 无连接设备，未产出/安装新 APK。沿用 qin 的签名保管和 Windows HBuilderX 打包路径；无需为本票变更签名或备份格式。

1. 记录手机型号、Android/WebView/HBuilderX 版本和应用构建；覆盖安装，确认旧 v1 数据仍在。
2. 离线逐一选择仓内 18 张图及静态编码样例，核对原图方向、比例，手工填用量，放大/返回时输入不丢。确认前后比较库存。
3. 先留一张有效预览和名称，再取消重选、选择损坏/动画/超限图、拒绝读取权限；已有输入和账本保持。检查失败后的重试入口。
4. 选择 WebP → 确认用量 → 杀进程重开 → 两种模板预览并保存到系统相册 → 导出 v1 备份 → 整体恢复；核对图像、用量、制作快照、余额和历史。
5. 验证 EXIF 方向、透明样例、页面大字及双指缩放、原图退出释放；记录大图处理耗时/内存和失败提示。支持旧系统时另测 Android 5–8 的完整解码与旋转路径。

完成这些记录及用户验收后再结项 #7；不修改或关闭来源规格 Issue。
