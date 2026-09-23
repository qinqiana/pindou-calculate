# 综合验收返修素材

`inputs/P002.png` 保留既有冻结组的真实输入，用于复现“单个深色色块加两个浅色色块”整行漏读。来自 [石弦原图](https://www.sxgrocery.com/pattern/1459)，原公开导出地址为 `https://www.sxgrocery.com/wp-json/b2/v1/downloadOffline?pattern_id=320`；2026-09-22 已采集，本次沿用该 PNG，不重绘、不称为新盲测。

主会话复核原图数量表：H6=361、C1=344、H9=319。返修前 `pixel-glyph-0.11.0-dev` 只保留深色色块的未配对疑点；返修后利用同尺寸浅色矩形边框恢复列间距，三色逐数一致。L011、P041 的同模板失败也已修复，保留在全量分母中。

该图片只作为必要测试素材，不进入 Android 应用资源。测试入口：`experiments/issue8/test_legend_layouts.py`。综合证据见 [验收记录](../../docs/acceptance/issues13-14/README.md)。
