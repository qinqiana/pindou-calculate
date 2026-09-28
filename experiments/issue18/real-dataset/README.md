# 真图数据集：清单、切分与冻结（Issue #26）

服务于[识图训练地图 #19](https://github.com/qinqiana/pindou-calculate/issues/19)。把 255 张已登记真图纸（外加 1 张色卡负样例 S00，共 256 条）汇成一份机器可读清单，按来源切成验证 / 测试 / 留出来源组并冻结。**图片本体不进 Git**；本目录只有清单、脚本与统计。

## 目录

| 文件 | 内容 |
| --- | --- |
| `build_inventory.py` | 从四份旧登记清单、参考答案、旧算法结果与图片副本生成 `inventory.json` / `inventory.md`；可重跑 |
| `inventory.json` | 256 条，每张图一条：来源、作者、排版、色卡内外、参考答案完整性、旧算法结果、像素尺寸、副本路径、URL 可达性 |
| `inventory.md` | 统计表、site 归一表、排版映射表、来源组规则、完整性与 URL 汇总、异常 |
| `url-check.json` | 474 个去重 URL 的逐条状态码原始记录（2026-09-28） |
| `old-algo-results-snapshot-2026-09-28.csv` | `experiments/issue8/results-current.csv` 在 2026-09-28 的冻结副本（原文件当时尚未提交），供清单复现 |
| `split.py` | 切分策略 v1，读 `inventory.json` 写 `manifest-v1.json`；只读输入、只写输出 |
| `manifest-v1.json` | **冻结清单**：每张图的 split / 留出标记 / 许可状态 / 来源组 / 排版 / 参考完整性 / 副本路径 |

复现（仓库根目录；主 checkout 的 `dist/.datasets/pindou-real/` 下须有图片副本，见下）：

```bash
PINDOU_REPO=/path/to/main-checkout python3 experiments/issue18/real-dataset/build_inventory.py build
python3 experiments/issue18/real-dataset/split.py \
  --inventory experiments/issue18/real-dataset/inventory.json \
  --out experiments/issue18/real-dataset/manifest-v1.json
```

`split.py` 用固定随机种子 20260928，重跑结果一致（只有 `frozen_at` 时间戳变化）。

## 图片在哪

- 副本：主 checkout 的 `dist/.datasets/pindou-real/originals/<group>/<id>__<原文件名>`（59MB，256 张；`dist/` 被 `.gitignore` 忽略）。复制记录在同目录上一级的 `copy-report.json`。
- 来源：foundation 19 张来自仓内 `参考样例/`；其余 237 张原先放在本机 `/tmp` 的任务目录（重启即丢），2026-09-28 全部复制成功、逐张用 PIL 打开核对，字节数与复制记录一致。
- **石弦的 114 个 `imageUrl` 已全部失效**（站点下载接口返回 404 `rest_no_route`），BitBead 另有 2 张（M005、M058）页面已删除；这些图**无法再从网上重取**，本机副本是唯一来源，请勿删除 `dist/.datasets/`。其余 imageUrl 仍可达（121 个 200）。

## 数量

| split | 张数 | BitBead | 石弦 | pixelbead.art | 用户提供(foundation) |
| --- | ---: | ---: | ---: | ---: | ---: |
| validation（验证：调参与选模型） | 130 | 61 | 57 | 0 | 12 |
| test（测试：只报成绩） | 126 | 46 | 57 | 16 | 7（含 S00 负例） |
| finetune（真图微调） | **0** | | | | |

- **留出来源组（heldout，只在 test）22 张**：pixelbead.art 全部 16 张（右侧数字排版）+ foundation 的 bead-pixel 2 张、rounded-below 4 张（色块内色号、数量在下）。它们从不进验证，用来衡量学生对没见过的来源的泛化。
- 每类排版在验证组都有真图：色号与括号数量同条 7、右侧数字 5（compact-right）、色块内色号数量在下 21、无图例逐格色号 41，另有 56 张 spot100 图（石弦 36、BitBead 20）未登记排版。
- 纯 MARD 221（无色卡外色号）156 张：validation 88 / test 68。按旧冻结组：foundation 18、new37 30、validation100 71、spot100 37——与旧算法基线（17/18、30/30、71/71、37/37）的分母一致，`group` 与 `pure_mard221` 字段原样保留，供「不退步」比较。
- 参考答案完整 254 张；S03 只有部分参考（不能算通过）；S00 无参考（色卡负例）。
- 来源组 155 个（作者已知按作者；作者未知的石弦/BitBead 图按图案或帖子编号分组）。

## 切分规则 v1（依据 [#23 许可与数据合规](https://github.com/qinqiana/pindou-calculate/issues/23)）

1. **只有许可状态为 `user_provided` / `permission_confirmed` 的图能进微调组。** 现有 256 张里没有一张满足：BitBead / 石弦 / pixelbead.art 的图记为 `tool_site_unverified`（站点公开不等于授权训练）；foundation 的 19 张登记原文自述「用户提供的仓内原文件……非版权或出处认证」，记为 `repo_provided_unverified`。因此 **v1 微调组为空，训练全靠合成数据**——与地图裁决一致。日后确认归属或取得书面许可，写一个 `permissions.json`（`{"user_owned_ids": [], "sites": [], "source_groups": []}`）传给 `split.py --permissions` 即可放开，不改脚本。
2. **同一来源组永不跨组**。脚本对全部组做自检，跨侧即报错退出。作者未知的站点按图案/帖子编号分组，这类站点的验证/测试切分不代表跨作者泛化——跨作者泛化由留出来源组衡量。
3. **留出来源组只进测试**：pixelbead.art 全部 + foundation 的 bead-pixel、rounded-below 模板组。compact-right（5 张）显式固定在验证组，让右侧数字排版在验证组有真图样本；该排版「没见过的来源」由 pixelbead.art 承担。
4. **S18（148 颗用户样例）是根规格验收锚点**，所在 douhua 模板组 7 张整体进验证组；**S00 色卡负样例固定进测试组**作负例。
5. 其余 BitBead / 石弦 按来源组、固定种子对半分到验证 / 测试，两个站点两侧都有。
6. **冻结**：`manifest-v1.json` 即定案。后续新增真图只能进新的追加清单（v2…），不回改 v1 的分母；来源方要求删除时，从本机副本与清单同时移除并在此登记。
7. 公开报告只写数字与统计，不贴整图；确需示意用最小裁块并注明来源。

## 已知边界

- foundation 的 S03–S15 文件名形似小红书缓存命名，但登记只写「用户提供」，来源页未核实——所以按「未确认」处理，不进微调组。
- validation100 / spot100 旧清单里的 `width/height` 是图纸格子数不是像素；像素尺寸以 `inventory.json` 的 PIL 实测为准。
- spot100 的 100 张没有登记排版（`layout_norm` 为 null）。
- `inventory.json` 生成时（2026-09-28）读取的四份登记清单与参考答案与 `origin/main` 提交 `34f874e` 逐字节一致；旧算法结果取自本目录的冻结 CSV 副本。
