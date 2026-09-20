# #7 编码边界样例

本任务用 Pillow 10.2.0 / libwebp 1.3.2 生成的合成图，无个人资料。80×48 画布左上 40×24 为不透明红色，右下为半透明蓝色，其余透明。

| 文件 | 编码/用途 |
| --- | --- |
| lossy.webp | RGB，有损 quality=85 |
| lossless.webp | RGB，无损 |
| transparent.webp | RGBA，无损；空区透明，蓝区 alpha=128 |
| rotated.webp | RGB，无损，EXIF orientation=6；显示应为 48×80 |
| animated.webp | 两帧 RGBA、100 ms；必须拒绝 |
| tiny.jpg | 合法 1×1 红色 JPEG，替换旧测试中只有文件头的伪图片 |

坏容器、坏压缩内容、截断和超限由测试在内存中构造。真实图纸仍使用仓内 18 张原始素材，不复制或修改它们。`tests/webp.test.ts` 的宿主解码是 Python/Pillow，Android 方法调用是测试替身，手机验收单独记录。
