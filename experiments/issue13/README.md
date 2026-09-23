# 长图分块回归

`validate.py` 先生成独立参考，再把图片路径单独交给识别子进程；识别进程不读取答案。输出逐图 JSON、分块检查点和 `results.csv`。五个清晰构造变体同属一个开发组，不能当成五张新真实图或泛化成绩。

- 人工编写的 47×104 格标记规则：每第八行及末行仅有两个边缘格，其余行循环七个色号和一格空白，共 3808 颗。覆盖白色 H2、近灰 H3/H5、相同底色但不同号的 F21/F24、5/10 格粗线、32×40 非方格、JPEG/WebP 压缩。字体 DejaVu Sans 12px，输入规则在识别前固定；水印变体只验降级。
- `inputs/N25.png` 是既有 BitBead 真实无数量表长图，51×81、325 颗、11 色。来自 [原站制作图](https://www.bitbead.app/zh/library/10000000-0000-4000-8000-000000002001)，作者署名 The Met Store / Pamela Love。沿用此前下载的原生 SVG 栅格化 PNG，未重绘或改号；`N25-reference.json` 是从原生 SVG 坐标文字独立累计的逐格记录。主会话目视检查原 PNG 的制作区、文字、空白和边缘，并与既有站点网格参考一致；不是新的盲测或独立人工 QA。
- 仓内 S14 为真实 47×104 水印长图。派生输入裁切 `[0,116,1080,2455]`，排除标题和数量表；仍保留编号框。当前定位候选包含编号框，报告 49×106，不能把这当制作尺寸。没有新的完整逐格人工真值，不作全对评分，原图图例仍可单独核对 31 色、3262 颗。
- S03 的 43116 标题原图缺完整参考，只验截断降级；没有按标题差额补数。

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python experiments/issue13/validate.py --output-dir /tmp/pindou-long-check
```

运行使用已有 Pillow、NumPy、OpenCV 环境，不新增依赖。完整结果及 Android 边界见 [#13–#14 验收记录](../../docs/acceptance/issues13-14/README.md)。
