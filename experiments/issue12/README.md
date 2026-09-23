# 无数量图例的本体计数

[samples.json](samples.json) 区分四张真实无数量表制作图、148 裁切开发图及两张同源水印爱心边界图。[references.json](references.json) 保留四张小图的逐行逐格参考，`.` 表示目视确认的空白。原 PNG、公开原生 SVG 的坐标文字由主会话逐格目视复核后独立累计；未使用识别器结果生成参考，不称为独立人工 QA。

四张 BitBead 图曾进入旧算法回归，同属一个站点制图模板；不能称为新盲测或四种版式。全部同组用于本轮冻结后回归，豆画派生图用于开发，水印爱心同组留作边界。公开来源、作者、栅格化方式及派生裁切范围在清单中；保持原文件的文字和布局，不从网页网格答案重绘输入。

识别子进程只接收图片路径，退出并写出结果后才读取参考答案。验收按每色每数完全相等，不沿用早期算法的 10% 容差。边界图保留所有错漏，要求不误报完整及疑点可定位；不把这个保护检查算作计数全对。

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python experiments/issue12/validate.py --output-dir /tmp/pindou-issue12-check
```

完整结论及手机证据见 [验收记录](../../docs/acceptance/issue12/README.md)。
