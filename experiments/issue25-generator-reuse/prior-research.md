# 识图训练：现成图纸生成器复用调查

日期：2026-09-29。关联[合成数据渲染器原型](https://github.com/qinqiana/pindou-calculate/issues/25)。用户已明确要求优先寻找现成拼豆图纸生成器；本次由两名 Sol 研究子代理分别核对开源源码和现成产品，主会话复核并整合。范围为选型调查，不重做 Android App，也不实施数据生成或模型训练。

## 结论

**有值得优先复用的现成工具，不应把自写整页生成器作为默认路线。推荐先验证 Bead Grid Studio（豆格工坊），belleqaq/perler-bead-generator 作为补充网格/SVG 来源。**

豆格工坊已有整页图纸绘制、逐格色号、空格及用量统计；缺口集中在把现有渲染和数据导出接成可重复的批量流程，以及同步导出训练框。预计需要的适配范围比重新开发整页制图功能小，但尚未运行验证，不能承诺适配耗时或训练效果。[整页渲染源码](https://github.com/zwhy149/bead-grid-studio/blob/main/src/app.js)、[命令行源码](https://github.com/zwhy149/bead-grid-studio/blob/main/bin/bead-grid.mjs)

## 推荐候选

| 候选 | 已有可复用能力 | 对本项目的缺口 | 建议 |
| --- | --- | --- | --- |
| **[Bead Grid Studio / 豆格工坊](https://github.com/zwhy149/bead-grid-studio)** | 浏览器整页 PNG 包含标题、四边坐标、逐格色号、图例色块、每色数量与总数；工程 JSON 保留格子；真实 CLI 可输入 PNG、自定义 JSON 色卡，导出 `grid.cells` 和 `statistics.colors`；Apache-2.0，色卡来源另有 NOTICE | CLI 输出 JSON，**不是整页 PNG 批量接口**；页面渲染与 CLI 需连接；无现成检测框导出；三种图例位置及隐藏图例不是现成模板开关；H1 必须显式覆盖 | **首选**。复用整页绘制和网格数据，只补批量入口、必要版式参数及标注输出 |
| **[belleqaq/perler-bead-generator](https://github.com/belleqaq/perler-bead-generator)** | 纯前端；PNG/SVG；JSON 保存 `cols/rows/grid`，格子是色号或 `null`；PDF/打印可含材料表；MIT | 无 CLI；普通 PNG 不绘格内色号；SVG 没有同页图例；SVG/PDF 编码网格将 H 系色号去掉 H 前缀，不能直接配 JSON 当文字真值 | **补充来源**，适合 SVG 网格与矢量位置；先修正字样与标签不一致，再考虑接入 |
| **[ya-chang/bead-pattern-generator](https://github.com/ya-chang/bead-pattern-generator)** | MIT、单文件前端；PNG/SVG 和逐色 CSV；内部有逐格索引与空格标记 | CSV 是逐色清单，不是逐格标签；缺少同页材料图例；高列数 PNG 会省略格内色号；无原生批量入口 | 简单网格备选，不能直接作为覆盖全部版式的唯一来源 |
| **[cornelk/beadmachine](https://github.com/cornelk/beadmachine)** | MIT、Go CLI；可指定 JSON 色卡；PNG、逐格 HTML、逐色统计，容易循环调用 | 默认 Hama；未发现明确空白格跳过语义；缺少目标整页图例和位置标注；HTML 版式与已有样例差异较大 | 批量入口备用，综合适配量比首选更大 |

上述输出语义分别依据：[豆格工坊 CLI](https://github.com/zwhy149/bead-grid-studio/blob/main/bin/bead-grid.mjs)、[豆格工坊 pattern 数据模型](https://github.com/zwhy149/bead-grid-studio/blob/main/packages/core/src/pattern.js)、[belleqaq 导出实现](https://github.com/belleqaq/perler-bead-generator/blob/main/js/exporter.js)、[ya-chang 导出实现](https://github.com/ya-chang/bead-pattern-generator/blob/main/index.html)、[beadmachine HTML 输出](https://github.com/cornelk/beadmachine/blob/main/html.go)。仓库代码许可分别见其 LICENSE；许可判断限于这些代码，不扩展到外部图片或第三方字体。[豆格工坊 LICENSE](https://github.com/zwhy149/bead-grid-studio/blob/main/LICENSE)、[NOTICE](https://github.com/zwhy149/bead-grid-studio/blob/main/NOTICE)、[belleqaq LICENSE](https://github.com/belleqaq/perler-bead-generator/blob/main/LICENSE)、[ya-chang LICENSE](https://github.com/ya-chang/bead-pattern-generator/blob/main/LICENSE)、[beadmachine LICENSE](https://github.com/cornelk/beadmachine/blob/main/LICENSE)

## 必须保留的三项数据语义

**1. H1 与空格分开。** 豆格工坊将 H1 标为透明色并排除在默认自动量化之外；但其数据模型把 `null` 作为空格，明确传入 `"H1"` 会正常计数。因此可以用明确的网格数据加入 H1 样本，不能把图片透明或空白区域自动当 H1，也不能认为默认图片量化已经覆盖全部 221 色。本项目 H1 仍是正式色号。[palette 实现](https://github.com/zwhy149/bead-grid-studio/blob/main/packages/core/src/palette.js)、[pattern 实现](https://github.com/zwhy149/bead-grid-studio/blob/main/packages/core/src/pattern.js)

双方基础色号集合经源码比对均为 221 个，但屏幕 HEX 不一致。生成器的参考色不覆盖本项目 `app/src/ledger/catalog.ts`；生成样本可保留有来源的屏幕色差，真值来自明确网格色号，不靠颜色最近邻重新猜答案。

**2. 画面文字必须与标签对应。** 主会话直接复核 belleqaq 的 `exportSVG`：`c.code.replace(/^H/, '')` 会让 JSON 的 `H1` 在 SVG 里显示为 `1`。子代理进一步核对 PDF 编码网格也有同样处理；普通 PNG 调用的 `renderToCanvas` 则只画格子颜色/形状，不画格内色号。这些默认图片都不能直接用工程 JSON 的色号字符串作为认字标签。SVG 的文字锚点也不是文字外接框，标注导出需使用实际绘制尺寸或浏览器文本边界。[exporter.js](https://github.com/belleqaq/perler-bead-generator/blob/main/js/exporter.js)、[editor.js](https://github.com/belleqaq/perler-bead-generator/blob/main/js/editor.js)

**3. 图片、标签、变换使用同一份网格和布局。** 同一份数据同时驱动图纸和逐格/逐色答案；检测框在绘制文字、色块、图例时记录。缩放和裁切同步变换框；JPEG/WebP 压缩和模糊不改原始真值，但遮挡或裁断后应另记录可读性/未知标签，不能要求模型猜被遮住的字符。这里是本项目建议的适配方法，不是候选工具已经具备的训练接口。

## 其他现成产品为何暂不优先

- **[pindou.ltd](https://www.pindou.ltd/)**：公开界面有 MARD221、设为空、PNG 和 JSON 按钮，适合手工小样；未取得足以证明 JSON 逐格字段、批量入口和复用许可的一手说明，暂不作为自动训练数据源。
- **[PindouAI](https://github.com/xuange6610/PindouAI)**：官方说明有离线图纸、MARD、PNG/PDF 和用量表；未核实批量生成及结构化真值导出。源码 Apache-2.0 不覆盖其内置图纸；后者单独见 [ARTWORK_LICENSE](https://github.com/xuange6610/PindouAI/blob/main/ARTWORK_LICENSE.md)。现成 App 功能较多，不是本次最轻的训练配套工具。
- **[PixelBeads.design](https://pixelbeads.design/editor/)** 与 **[pixel-beads.com](https://www.pixel-beads.com/help)**：都有直接制图/材料统计的官方说明，但未核实逐格答案或框输出；前者 CSV 在[官方指南](https://pixelbeads.design/guide/)中指向材料规划，不能直接当逐格真值。
- **[GeorgeChou17/beadgrid](https://github.com/GeorgeChou17/beadgrid)**：搜索缓存记载 XLSX 与 Apache-2.0，但本次当前仓库/源码/许可访问失败，不能据此确认可直接复用，也不据此断言项目不存在。

## 对当前决策票的建议

把目标从“扩写旧字形合成器、自己实现整页绘制”改成：**现成生成器复用选型与标注导出验证**。

首选的最小验证应只覆盖：用一份自制小网格（含 H1、有字白格、无字空格、重复颜色）产生图纸和 JSON；核对逐格内容与逐色总数；取得图例项和文字位置；确认重复调用不混图。先验证已有渲染入口，缺少的版式变化再作有限适配，不重做完整生成器、画板、色彩量化器或安卓界面。本轮仅提出这一步，没有执行第三方代码或生成训练集。

冻结测试来源不得为了迁就候选而改动。本仓冻结清单的留出来源包括 `pixelbead.art/www.pixelbead.art`、`rounded-below`、`bead-pixel`；它们不能与名称近似的其他网站混为一谈。若之后发现候选复用了留出来源的模板或实现，须记录独立性影响，不再用该部分成绩宣称未见来源泛化。此项依据现有 `data/issue18-real-dataset` 分支的冻结清单，不新增划分。

## 实际完成与限制

- 已完成两名 Sol 的并行一手资料调查、源码导出语义核查，主会话复核推荐、H 系字样问题及既有冻结来源。研究子代理不算独立 QA。
- 未安装新依赖、运行第三方生成器、上传用户图片、下载批量图库或改动 Android App；没有量产图片、坐标对齐或训练效果的运行证据。
- 本报告只推荐优先验证的复用路径；没有修改或关闭“合成数据渲染器原型”票，没有改变模型架构和标注真源。
