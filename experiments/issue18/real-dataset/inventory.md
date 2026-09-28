# Issue #26 真图清单（inventory）统计与说明

生成时间：2026-09-28T15:21:29+00:00（UTC）；生成脚本：本目录 `build_inventory.py`。
本文件只做事实汇总与统计，**不做任何切分决策**。
文中「实测」= 用 PIL 打开图片副本得到；「清单原值」= 四份登记清单照抄；「推断」= 按下文写明规则推导，均标注。

总条数：**256**（应为 256）。

## 按组（group）计数

| group | 张数 | 说明 |
| --- | ---: | --- |
| foundation | 19 | 19 张 = 18 张图纸 + 1 张色卡负样例 S00；用户提供仓内原文件 |
| new37 | 37 | 37 张；Pixelbead 10 + BitBead 27（site 为域名推断） |
| validation100 | 100 | 100 张；BitBead 60 + 石弦 34 + pixelbead.art 6 |
| spot100 | 100 | 100 张；清单 site 字段为 石弦 80 + BitBead 20，与 sourcePage 域名及该组 README（20 BitBead + 80 石弦）一致 |

## 按 site（归一后）计数

| site | 张数 |
| --- | ---: |
| 石弦 | 114 |
| BitBead | 107 |
| 用户提供 | 19 |
| pixelbead.art | 16 |

site 归一表（事实规则）：

| 原值（清单 site 或域名） | 归一值 |
| --- | --- |
| BitBead | BitBead |
| bitbead.app | BitBead |
| pixelbead.art | pixelbead.art |
| sxgrocery.com | 石弦 |
| www.bitbead.app | BitBead |
| www.pixelbead.art | pixelbead.art |
| www.sxgrocery.com | 石弦 |
| 石弦 | 石弦 |

- foundation 清单无 site 字段，`source` 字段写明「用户提供的仓内原文件」，记 `用户提供`（`site_inferred=false`，属登记信息）。
- new37 清单无 site 字段，从 `sourcePage` 域名推断（`site_inferred=true`）。
- validation100/spot100 清单有 site 字段，归一后与 sourcePage 域名逐张交叉核对；若出现冲突则以域名为准并标 `site_inferred=true`（本次核对结果见下）。

## 按 layout_norm 计数

| layout_norm | 张数 |
| --- | ---: |
| None | 100 |
| grid-labels-without-legend | 87 |
| legend-in-swatch-below | 40 |
| legend-right-number | 21 |
| legend-inline-count | 7 |
| unknown | 1 |

layout 映射表（推断规则）：

| 清单原值 | layout_norm |
| --- | --- |
| 色块内色号、数量在下 | legend-in-swatch-below |
| 色号与括号数量同条 | legend-inline-count |
| 色号与括号数量同条；第二行单独 H7 | legend-inline-count |
| 色号色块右侧数量 | legend-right-number |
| 非图纸色卡 | unknown |
| below | legend-in-swatch-below |
| right | legend-right-number |
| grid-labels-without-legend | grid-labels-without-legend |
| （spot100 无 layout 字段） | null |

说明：`非图纸色卡` 是 S00 色卡负样例，不属于四种图纸版式，记 `unknown`；`色号与括号数量同条；第二行单独 H7`（S18）主体仍是同条式，归 `legend-inline-count`。

## pure_mard221（outsideCatalog 为空）计数

| pure_mard221 | 张数 |
| --- | ---: |
| False | 99 |
| None | 19 |
| True | 138 |

说明：foundation 清单没有 `outsideCatalog` 字段，19 张记 `null`（未登记，未编造）；其余三组按清单 `outsideCatalog` 数组是否为空判定。

## reference_complete 计数

| reference_complete | 张数 |
| --- | ---: |
| False | 1 |
| None | 1 |
| True | 254 |

判定规则：参考答案 `status=="complete"` 且 CSV `referenceComplete` 不为 false → true；参考 status 为其他值 → false；两侧都无记录（S00）→ null。foundation 的参考答案文件 references-v05.json 只有 S01–S18 共 18 条（17 complete + 1 partial(S03)），S00 色卡无参考答案。

## 旧算法结果（results-current.csv 原值）

| old_algo_status | 张数 |
| --- | ---: |
| failed | 6 |
| partial | 249 |
| ready | 1 |

| old_algo_passed | 张数 |
| --- | ---: |
| False | 100 |
| None | 1 |
| True | 155 |

## source_group（作者/系列分组键）分布

共 **76** 个分组键。

分组规则（推断）：foundation 用清单自带 `source_group`；其余组用 `site + "/" + creator_norm`；creator 为空或占位值 `unknown` 时用 `site + "/" + sourcePage 域名`。`creator_norm` = 去首尾空白、内部空白压成一个空格、ASCII casefold。同站同作者必得同键。

张数 ≥3 的分组：

| source_group | 张数 |
| --- | ---: |
| 石弦/www.sxgrocery.com | 80 |
| BitBead/www.bitbead.app | 22 |
| pixelbead.art/www.pixelbead.art | 16 |
| douhua | 7 |
| 石弦/今天天气不错 | 6 |
| compact-right | 5 |
| BitBead/晚炀 | 5 |
| 石弦/半糖去冰 | 5 |
| 石弦/萧桐 | 5 |
| 石弦/隔壁阿橘 | 5 |
| rounded-below | 4 |
| 石弦/小满未满 | 4 |
| BitBead/yifu sun | 3 |
| BitBead/juan7927 | 3 |
| BitBead/張湫行 | 3 |
| BitBead/18152092167 | 3 |
| BitBead/abigail vong | 3 |
| 石弦/曾子 | 3 |
| 石弦/谢浩可 | 3 |
| 石弦/一只柴犬 | 3 |

其余 56 个分组每组不足 3 张（合计 68 张）。

## 文件完整性（PIL 实测）

- 打不开：**0** 张。
- 副本字节数与 copy-report 不符：见异常清单（无则未列出）。
- 尺寸不符（foundation，清单声明的是像素，应与实测一致）：**0** 张。
- 尺寸不符（validation100/spot100）：160 张，**全部属预期**——这两组清单的 width/height 是图纸格子数（如 M001 为 61x44 格），不是图片像素，与 PIL 实测像素天然不等；逐张数值在 inventory.json 的 `manifest_width/height` 与 `width/height` 字段，不在此逐条罗列。
- 无清单声明尺寸（`dims_match=null`）：{'new37': 37, 'validation100': 40}（new37 全部无声明；validation100 的 40 张石弦/pixelbead.art 记录无 width/height 字段）。

## URL 可达性汇总

共检查 474 个去重 URL（HEAD，失败时最小 GET；逐条间隔 1 秒；遇 429 即停）。

| URL 类型 | 状态码 | 张数 |
| --- | --- | ---: |
| imageUrl | 200 | 121 |
| imageUrl | 404 | 116 |
| sourcePage | 200 | 235 |
| sourcePage | 404 | 2 |

foundation 19 张无 imageUrl/sourcePage，`url_check=null`。

## 异常与未核实事项

- S03–S15 的 webp 文件名形如「时间戳_UUID_数字ID_宽x高.webp」，看起来像社交平台（小红书）缓存命名，但清单只写「用户提供的仓内原文件」，**未核实**具体来源页，site 统一记 `用户提供`。
- 本次生成时 spot100 清单 `site` 字段（石弦 80 + BitBead 20）与 sourcePage 域名完全一致，无冲突。注意：本任务进行期间主工作区的登记清单正被其他会话改动（曾观察到该文件 site 字段短暂不一致），本清单以生成时刻的文件内容为准。
- foundation 的 `reference_status` 字段在样本清单里多为 `unknown`，而参考答案文件 references-v05.json 里 S01–S18 已有 status（17 complete + 1 partial）；本清单 `reference_status` 取参考答案文件原值。两处登记口径不同，未修改任何一方。
- S00 是 MARD221 色卡负样例（kind=color-card），无参考答案、无 expected；CSV 中 status=failed、paletteRejected=true，属预期的负样例行为。
- validation100 有 2 张（见 CSV failed）与 spot100 有 3 张 failed、foundation S00 failed，均为旧算法运行状态原值，与文件完整性无关。
- URL 检查只代表检查时刻的可达性；`error:...` 为网络层错误（超时/拒绝等），不等于资源不存在。
- 石弦 114 条 `imageUrl`（`wp-json/b2/v1/downloadOffline` 接口）全部 404：HEAD 与最小 GET 均 404，响应体为 WordPress `rest_no_route`（「未找到匹配 URL 和请求方式的路由」），即该下载接口路由已不存在；对应 114 条 `sourcePage`（/pattern/<id> 页面）全部 200。图片副本早已落地，不影响本数据集使用，但意味着无法再从该接口重新下载原图。
- BitBead 有 2 张图（imageUrl 与 sourcePage 均 404，共 4 个 URL）：对应页面已删除，见清单中 status=404 的记录。

## 字段口径速查

- `bytes`：副本文件实测字节数（与 copy-report 登记核对）。
- `format/width/height`：PIL 实测；`manifest_width/height`：清单声明（无则 null）。
- `dims_match`：仅在清单声明与实测都存在时比较；validation100/spot100 声明是格子数，预期 false。
- `creator` 照抄原值；`creator_norm` 归一；`brand` 仅 validation100/spot100 有，其余 null。
- `reference_color_count` = expected 色号个数；`reference_total` = expected 数量合计；`reference_unknown` = unknown 数组长度；无参考答案则三者 null。
- `old_algo_within_tolerance`：CSV `outsideTolerance` 为空/`{}` → true。
