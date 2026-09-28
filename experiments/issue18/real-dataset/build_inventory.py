#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_inventory.py — Issue #26 前半段：256 张已登记真图的清单汇总与完整性核对。

运行方式（在仓库根目录，系统 python3 即可，只需 Pillow；仓库根默认取脚本所在目录的上三级，可用环境变量 PINDOU_REPO 覆盖）：

    # 第 1 步（可选，约 10 分钟）：URL 可达性检查，结果增量写入本目录 url-check.json
    python3 experiments/issue18/real-dataset/build_inventory.py urlcheck

    # 第 2 步：生成 inventory.json 与 inventory.md（若 url-check.json 存在则并入）
    python3 experiments/issue18/real-dataset/build_inventory.py build

    # 也可以一次跑两步：
    python3 experiments/issue18/real-dataset/build_inventory.py all

只读登记清单 / 参考答案 / 旧算法结果 CSV（默认用本目录冻结的 old-algo-results-snapshot-2026-09-28.csv，
可用环境变量 PINDOU_RESULTS_CSV 指向其他副本）与 dist/.datasets 下的图片副本；只写本目录。
不做任何切分决策，不修改仓库已跟踪文件。
"""
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("PINDOU_REPO") or os.path.abspath(os.path.join(OUT_DIR, "..", "..", ".."))
URL_CHECK_FILE = os.path.join(OUT_DIR, "url-check.json")
INVENTORY_JSON = os.path.join(OUT_DIR, "inventory.json")
INVENTORY_MD = os.path.join(OUT_DIR, "inventory.md")

# ---------------------------------------------------------------- 输入路径
MANIFESTS = {
    "foundation": "experiments/issue8/samples.json",
    "new37": "experiments/issue8/new-samples-v03.json",
    "validation100": "experiments/issue8/validation-100/samples.json",
    "spot100": "experiments/issue8/validation-spot-2026-09-22/samples.json",
}
REFERENCES = {
    "foundation": "experiments/issue8/references-v05.json",
    "new37": "experiments/issue8/new-references-v03.json",
    "validation100": "experiments/issue8/validation-100/references.json",
    "spot100": "experiments/issue8/validation-spot-2026-09-22/references.json",
}
RESULTS_CSV = os.environ.get("PINDOU_RESULTS_CSV") or os.path.join(OUT_DIR, "old-algo-results-snapshot-2026-09-28.csv")
COPY_REPORT = "dist/.datasets/pindou-real/copy-report.json"

# ---------------------------------------------------------------- 归一规则（同时写进 inventory.md）
# site 归一：清单 site 字段或 sourcePage 域名 -> 统一值
SITE_BY_DOMAIN = {
    "www.bitbead.app": "BitBead",
    "bitbead.app": "BitBead",
    "www.sxgrocery.com": "石弦",
    "sxgrocery.com": "石弦",
    "www.pixelbead.art": "pixelbead.art",
    "pixelbead.art": "pixelbead.art",
}
SITE_BY_MANIFEST = {
    "BitBead": "BitBead",
    "石弦": "石弦",
    "sxgrocery.com": "石弦",
    "pixelbead.art": "pixelbead.art",
}
# layout 归一映射表
LAYOUT_MAP = {
    # foundation 中文原值
    "色块内色号、数量在下": "legend-in-swatch-below",
    "色号与括号数量同条": "legend-inline-count",
    "色号与括号数量同条；第二行单独 H7": "legend-inline-count",
    "色号色块右侧数量": "legend-right-number",
    "非图纸色卡": "unknown",
    # 其他组英文原值
    "below": "legend-in-swatch-below",
    "right": "legend-right-number",
    "grid-labels-without-legend": "grid-labels-without-legend",
}
# 视为“无作者”的 creator 占位值（归一后比较）
CREATOR_EMPTY = {"", "unknown", "未知"}


def load_json(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return json.load(f)


def creator_norm(creator):
    """去首尾空白、内部空白压缩为一个空格、ASCII 大小写归一（casefold）。"""
    if creator is None:
        return None
    norm = " ".join(str(creator).split()).casefold()
    return norm


def domain_of(url):
    if not url:
        return None
    return urllib.parse.urlparse(url).netloc.lower()


def normalize_site(group, sample):
    """返回 (site, site_inferred, note)。note 非空表示与清单原值不一致的说明。"""
    dom = domain_of(sample.get("sourcePage"))
    dom_site = SITE_BY_DOMAIN.get(dom)
    note = None
    if group == "foundation":
        # 清单无 site 字段，source 字段写明“用户提供的仓内原文件”，属登记信息而非推断
        return "用户提供", False, None
    if group == "new37":
        # 清单无 site 字段，从 sourcePage 域名推断
        if dom_site:
            return dom_site, True, None
        return ("其他:" + dom if dom else None), True, None
    raw = sample.get("site")
    manifest_site = SITE_BY_MANIFEST.get(raw, ("其他:" + raw) if raw else None)
    if dom_site and manifest_site and dom_site != manifest_site:
        # spot100 有 20 条清单 site=石弦 但 sourcePage 是 bitbead.app，与该组 README
        # （20 张 BitBead + 80 张石弦）一致，以域名为准并标注推断
        note = f"清单 site={raw} 与 sourcePage 域名 {dom} 不一致，按域名归一为 {dom_site}"
        return dom_site, True, note
    return manifest_site, False, None


def make_source_group(group, sample, site):
    """作者/系列分组键。foundation 用自带 source_group；其余用 site/creator_norm，
    creator 为空（含 unknown 占位）时用 site/域名。同作者同站同键。"""
    if group == "foundation":
        return sample.get("source_group")
    cn = creator_norm(sample.get("creator"))
    if cn is None or cn in CREATOR_EMPTY:
        dom = domain_of(sample.get("sourcePage")) or "unknown-domain"
        return f"{site}/{dom}"
    return f"{site}/{cn}"


def outside_tol_empty(val):
    if val is None:
        return None
    v = val.strip()
    if v in ("", "{}", "0"):
        return True
    try:
        return len(json.loads(v)) == 0
    except Exception:
        return False


def parse_bool(val):
    if val is None or val == "":
        return None
    return val.strip().lower() == "true"


# ---------------------------------------------------------------- URL 检查
def collect_urls(samples_by_group):
    """返回 {url: None} 去重后的待查 URL 列表（保持出现顺序）。"""
    urls = []
    seen = set()
    for group in ("foundation", "new37", "validation100", "spot100"):
        for s in samples_by_group[group]:
            for key in ("imageUrl", "sourcePage"):
                u = s.get(key)
                if u and u not in seen:
                    seen.add(u)
                    urls.append(u)
    return urls


def check_one_url(url):
    """HEAD 检查；405/501/404 时退回一次最小 GET（读 0 字节即关，不落盘）——
    部分下载接口（如石弦 downloadOffline）不支持 HEAD，HEAD 404 不等于 GET 404。
    每个 URL 至多两次请求，不额外重试。返回状态码或 'error:...'。"""
    req = urllib.request.Request(url, method="HEAD",
                                 headers={"User-Agent": "pindou-inventory-check/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        if e.code in (404, 405, 501):
            req = urllib.request.Request(url, method="GET",
                                         headers={"User-Agent": "pindou-inventory-check/1.0"})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return resp.status
            except urllib.error.HTTPError as e2:
                return e2.code
            except Exception as e2:  # noqa: BLE001
                return f"error:{type(e2).__name__}"
        return e.code
    except Exception as e:  # noqa: BLE001
        return f"error:{type(e).__name__}"


def run_url_check(samples_by_group):
    """逐条 HEAD，域名内间隔 1 秒；增量落盘，可断点续跑；遇 429 立即停止。"""
    results = {}
    if os.path.exists(URL_CHECK_FILE):
        with open(URL_CHECK_FILE, encoding="utf-8") as f:
            results = json.load(f)
    urls = collect_urls(samples_by_group)
    todo = [u for u in urls if u not in results]
    print(f"URL 总数(去重) {len(urls)}，已查 {len(results)}，待查 {len(todo)}", flush=True)
    last_domain = None
    stopped_by_429 = False
    for i, url in enumerate(todo):
        dom = domain_of(url)
        if last_domain is not None:
            time.sleep(1.0)  # 每条请求之间 1 秒间隔
        status = check_one_url(url)
        results[url] = {"status": status,
                        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        print(f"[{i + 1}/{len(todo)}] {status} {url}", flush=True)
        # 增量保存，防止中途失败丢失
        with open(URL_CHECK_FILE, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
        if status == 429:
            print("遇到 429 限流，按约定立即停止，不再重试。", flush=True)
            stopped_by_429 = True
            break
        last_domain = dom
    return results, stopped_by_429


# ---------------------------------------------------------------- 主构建
def build():
    samples_by_group = {}
    for group, rel in MANIFESTS.items():
        data = load_json(rel)
        samples_by_group[group] = data["samples"] if isinstance(data, dict) else data

    refs_by_group = {}
    for group, rel in REFERENCES.items():
        data = load_json(rel)
        refs_by_group[group] = data["samples"]

    with open(RESULTS_CSV if os.path.isabs(RESULTS_CSV) else os.path.join(REPO, RESULTS_CSV), encoding="utf-8") as f:
        csv_rows = {(r["group"], r["id"]): r for r in csv.DictReader(f)}

    copy_report = load_json(COPY_REPORT)
    copy_by_id = {}
    for group, grp in copy_report.items():
        for row in grp["rows"]:
            copy_by_id[(group, row["id"])] = row

    url_results = {}
    if os.path.exists(URL_CHECK_FILE):
        with open(URL_CHECK_FILE, encoding="utf-8") as f:
            url_results = json.load(f)

    from PIL import Image

    inventory = []
    anomalies = []           # 异常与未核实事项（写进 inventory.md）
    site_notes = Counter()   # site 冲突说明计数

    for group in ("foundation", "new37", "validation100", "spot100"):
        for s in samples_by_group[group]:
            gid = s["id"]
            rec = {"id": gid, "group": group}

            # ---- 副本与文件完整性（PIL 实测）
            cp = copy_by_id.get((group, gid))
            if cp is None:
                rec.update(copy_path=None, bytes=None, format=None, width=None,
                           height=None, opens_ok=False)
                anomalies.append(f"{group}/{gid}：copy-report 中无复制记录")
            else:
                rec["copy_path"] = cp["dst"]
                abs_path = os.path.join(REPO, cp["dst"])
                if not os.path.exists(abs_path):
                    rec.update(bytes=None, format=None, width=None, height=None,
                               opens_ok=False)
                    anomalies.append(f"{group}/{gid}：副本文件不存在 {cp['dst']}")
                else:
                    actual_bytes = os.path.getsize(abs_path)
                    rec["bytes"] = actual_bytes
                    if actual_bytes != cp["bytes"]:
                        anomalies.append(
                            f"{group}/{gid}：副本字节数 {actual_bytes} 与 copy-report "
                            f"登记 {cp['bytes']} 不符")
                    try:
                        with Image.open(abs_path) as im:
                            im.verify()
                        with Image.open(abs_path) as im:
                            rec["format"] = im.format
                            rec["width"], rec["height"] = im.size
                        rec["opens_ok"] = True
                    except Exception as e:  # noqa: BLE001
                        rec.update(format=None, width=None, height=None, opens_ok=False)
                        anomalies.append(f"{group}/{gid}：PIL 打不开（{type(e).__name__}: {e}）")

            rec["original_path"] = s.get("path")

            # ---- 清单声明尺寸（注意：validation100/spot100 的 width/height 是图纸格子数，
            #      foundation 是像素；new37 无声明）
            mw = s.get("width")
            mh = s.get("height")
            rec["manifest_width"] = mw
            rec["manifest_height"] = mh
            if mw is None or mh is None or rec.get("width") is None:
                rec["dims_match"] = None
            else:
                rec["dims_match"] = (mw == rec["width"] and mh == rec["height"])
                # validation100/spot100 的清单尺寸是图纸格子数（非像素），不符属预期，不入异常；
                # 只有 foundation（清单声明为像素）不符才记异常。
                if not rec["dims_match"] and group == "foundation":
                    anomalies.append(
                        f"{group}/{gid}：清单声明 {mw}x{mh} 像素，实测 {rec['width']}x{rec['height']} 像素")

            # ---- 来源字段
            site, site_inferred, note = normalize_site(group, s)
            rec["site"] = site
            rec["site_inferred"] = site_inferred
            if note:
                site_notes[note] += 1
            rec["creator"] = s.get("creator")
            rec["creator_norm"] = creator_norm(s.get("creator"))
            rec["brand"] = s.get("brand")
            rec["sourcePage"] = s.get("sourcePage")
            rec["imageUrl"] = s.get("imageUrl")
            rec["postId"] = s.get("postId")
            rec["patternId"] = s.get("patternId")
            rec["source_group"] = make_source_group(group, s, site)

            # ---- 版式
            layout = s.get("layout")
            rec["layout"] = layout
            if layout is None:
                rec["layout_norm"] = None  # spot100 清单无 layout 字段
            else:
                rec["layout_norm"] = LAYOUT_MAP.get(layout)
                if rec["layout_norm"] is None:
                    rec["layout_norm"] = "unknown"
                    anomalies.append(f"{group}/{gid}：layout 原值 {layout!r} 无映射，记 unknown")

            # ---- 色卡范围
            oc = s.get("outsideCatalog")  # foundation 无此字段 -> None
            rec["outside_catalog"] = oc
            rec["pure_mard221"] = (len(oc) == 0) if oc is not None else None

            # ---- 参考答案
            ref = refs_by_group[group].get(gid)
            rec["reference_status"] = ref.get("status") if ref else None
            if ref and ref.get("expected"):
                rec["reference_color_count"] = len(ref["expected"])
                rec["reference_total"] = sum(ref["expected"].values())
            else:
                rec["reference_color_count"] = None
                rec["reference_total"] = None
            rec["reference_unknown"] = len(ref.get("unknown", [])) if ref else None

            # ---- 旧算法结果
            row = csv_rows.get((group, gid))
            if row is None:
                rec.update(old_algo_status=None, old_algo_passed=None,
                           old_algo_within_tolerance=None, old_algo_elapsed_seconds=None)
                anomalies.append(f"{group}/{gid}：results-current.csv 中无记录")
            else:
                rec["old_algo_status"] = row["status"] or None
                rec["old_algo_passed"] = parse_bool(row["passed"])
                rec["old_algo_within_tolerance"] = outside_tol_empty(row["outsideTolerance"])
                try:
                    rec["old_algo_elapsed_seconds"] = float(row["elapsedSeconds"])
                except (TypeError, ValueError):
                    rec["old_algo_elapsed_seconds"] = None

            # reference_complete：综合参考答案 status 与 CSV referenceComplete
            ref_status = rec["reference_status"]
            csv_rc = parse_bool(row["referenceComplete"]) if row else None
            if ref_status is None and csv_rc is None:
                rec["reference_complete"] = None
            elif ref_status == "complete" and csv_rc is False:
                rec["reference_complete"] = False
                anomalies.append(f"{group}/{gid}：参考 status=complete 但 CSV referenceComplete=false，按 false 记")
            elif ref_status == "complete":
                rec["reference_complete"] = True
            else:
                rec["reference_complete"] = False

            # ---- URL 检查结果
            iu = rec["imageUrl"]
            sp = rec["sourcePage"]
            if not iu and not sp:
                rec["url_check"] = None
            else:
                iu_r = url_results.get(iu) if iu else None
                sp_r = url_results.get(sp) if sp else None
                rec["url_check"] = {
                    "imageUrl_status": iu_r["status"] if iu_r else None,
                    "sourcePage_status": sp_r["status"] if sp_r else None,
                    "checked_at": (iu_r or sp_r or {}).get("checked_at"),
                }

            inventory.append(rec)

    # ------------------------------------------------ 全局一致性校验
    ids = [r["id"] for r in inventory]
    dup = [k for k, c in Counter((r["group"], r["id"]) for r in inventory).items() if c > 1]
    if dup:
        anomalies.append(f"存在重复 (group,id)：{dup}")
    if len(inventory) != 256:
        anomalies.append(f"清单条数 {len(inventory)} != 256")
    for group in ("foundation", "new37", "validation100", "spot100"):
        manifest_ids = {s["id"] for s in samples_by_group[group]}
        inv_ids = {r["id"] for r in inventory if r["group"] == group}
        if manifest_ids != inv_ids:
            anomalies.append(f"{group}：清单 id 与 inventory id 不一致 "
                             f"（缺 {sorted(manifest_ids - inv_ids)}，多 {sorted(inv_ids - manifest_ids)}）")
        csv_ids = {k[1] for k in csv_rows if k[0] == group}
        if csv_ids != inv_ids:
            anomalies.append(f"{group}：CSV id 与清单 id 不一致")

    with open(INVENTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(inventory, f, ensure_ascii=False, indent=1)
    print(f"已写 {INVENTORY_JSON}：{len(inventory)} 条")

    write_markdown(inventory, anomalies, site_notes, url_results)
    print(f"已写 {INVENTORY_MD}")
    return inventory, anomalies


# ---------------------------------------------------------------- Markdown 报告
def write_markdown(inventory, anomalies, site_notes, url_results):
    def cnt(key):
        return Counter(str(r.get(key)) for r in inventory)

    lines = []
    a = lines.append
    a("# Issue #26 真图清单（inventory）统计与说明")
    a("")
    a(f"生成时间：{datetime.now(timezone.utc).isoformat(timespec='seconds')}（UTC）；"
      f"生成脚本：本目录 `build_inventory.py`。")
    a("本文件只做事实汇总与统计，**不做任何切分决策**。")
    a("文中「实测」= 用 PIL 打开图片副本得到；「清单原值」= 四份登记清单照抄；"
      "「推断」= 按下文写明规则推导，均标注。")
    a("")
    a(f"总条数：**{len(inventory)}**（应为 256）。")
    a("")

    a("## 按组（group）计数")
    a("")
    a("| group | 张数 | 说明 |")
    a("| --- | ---: | --- |")
    group_note = {
        "foundation": "19 张 = 18 张图纸 + 1 张色卡负样例 S00；用户提供仓内原文件",
        "new37": "37 张；Pixelbead 10 + BitBead 27（site 为域名推断）",
        "validation100": "100 张；BitBead 60 + 石弦 34 + pixelbead.art 6",
        "spot100": "100 张；清单 site 字段为 石弦 80 + BitBead 20，与 sourcePage 域名及"
                   "该组 README（20 BitBead + 80 石弦）一致",
    }
    for g, n in cnt("group").items():
        a(f"| {g} | {n} | {group_note.get(g, '')} |")
    a("")

    a("## 按 site（归一后）计数")
    a("")
    a("| site | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("site").items(), key=lambda x: -x[1]):
        a(f"| {k} | {n} |")
    a("")
    a("site 归一表（事实规则）：")
    a("")
    a("| 原值（清单 site 或域名） | 归一值 |")
    a("| --- | --- |")
    for k, v in sorted({**SITE_BY_DOMAIN, **SITE_BY_MANIFEST}.items()):
        a(f"| {k} | {v} |")
    a("")
    a("- foundation 清单无 site 字段，`source` 字段写明「用户提供的仓内原文件」，记 `用户提供`"
      "（`site_inferred=false`，属登记信息）。")
    a("- new37 清单无 site 字段，从 `sourcePage` 域名推断（`site_inferred=true`）。")
    a("- validation100/spot100 清单有 site 字段，归一后与 sourcePage 域名逐张交叉核对；"
      "若出现冲突则以域名为准并标 `site_inferred=true`（本次核对结果见下）。")
    a("")

    a("## 按 layout_norm 计数")
    a("")
    a("| layout_norm | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("layout_norm").items(), key=lambda x: -x[1]):
        a(f"| {k} | {n} |")
    a("")
    a("layout 映射表（推断规则）：")
    a("")
    a("| 清单原值 | layout_norm |")
    a("| --- | --- |")
    for k, v in LAYOUT_MAP.items():
        a(f"| {k} | {v} |")
    a("| （spot100 无 layout 字段） | null |")
    a("")
    a("说明：`非图纸色卡` 是 S00 色卡负样例，不属于四种图纸版式，记 `unknown`；"
      "`色号与括号数量同条；第二行单独 H7`（S18）主体仍是同条式，归 `legend-inline-count`。")
    a("")

    a("## pure_mard221（outsideCatalog 为空）计数")
    a("")
    a("| pure_mard221 | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("pure_mard221").items()):
        a(f"| {k} | {n} |")
    a("")
    a("说明：foundation 清单没有 `outsideCatalog` 字段，19 张记 `null`（未登记，未编造）；"
      "其余三组按清单 `outsideCatalog` 数组是否为空判定。")
    a("")

    a("## reference_complete 计数")
    a("")
    a("| reference_complete | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("reference_complete").items()):
        a(f"| {k} | {n} |")
    a("")
    a("判定规则：参考答案 `status==\"complete\"` 且 CSV `referenceComplete` 不为 false → true；"
      "参考 status 为其他值 → false；两侧都无记录（S00）→ null。"
      "foundation 的参考答案文件 references-v05.json 只有 S01–S18 共 18 条"
      "（17 complete + 1 partial(S03)），S00 色卡无参考答案。")
    a("")

    a("## 旧算法结果（results-current.csv 原值）")
    a("")
    a("| old_algo_status | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("old_algo_status").items()):
        a(f"| {k} | {n} |")
    a("")
    a("| old_algo_passed | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(cnt("old_algo_passed").items()):
        a(f"| {k} | {n} |")
    a("")

    a("## source_group（作者/系列分组键）分布")
    a("")
    groups = Counter(r["source_group"] for r in inventory)
    a(f"共 **{len(groups)}** 个分组键。")
    a("")
    a("分组规则（推断）：foundation 用清单自带 `source_group`；其余组用 "
      "`site + \"/\" + creator_norm`；creator 为空或占位值 `unknown` 时用 "
      "`site + \"/\" + sourcePage 域名`。`creator_norm` = 去首尾空白、内部空白压成一个空格、"
      "ASCII casefold。同站同作者必得同键。")
    a("")
    a("张数 ≥3 的分组：")
    a("")
    a("| source_group | 张数 |")
    a("| --- | ---: |")
    for k, n in sorted(groups.items(), key=lambda x: -x[1]):
        if n >= 3:
            a(f"| {k} | {n} |")
    a("")
    a(f"其余 {sum(1 for n in groups.values() if n < 3)} 个分组每组不足 3 张"
      f"（合计 {sum(n for n in groups.values() if n < 3)} 张）。")
    a("")

    a("## 文件完整性（PIL 实测）")
    a("")
    open_bad = [r for r in inventory if not r["opens_ok"]]
    a(f"- 打不开：**{len(open_bad)}** 张" + ("：" + ", ".join(f"{r['group']}/{r['id']}" for r in open_bad) if open_bad else "。"))
    a("- 副本字节数与 copy-report 不符：见异常清单（无则未列出）。")
    dim_bad_foundation = [r for r in inventory if r["dims_match"] is False and r["group"] == "foundation"]
    dim_bad_other = [r for r in inventory if r["dims_match"] is False and r["group"] != "foundation"]
    dim_null = Counter(r["group"] for r in inventory if r["dims_match"] is None)
    a(f"- 尺寸不符（foundation，清单声明的是像素，应与实测一致）：**{len(dim_bad_foundation)}** 张"
      + ("：" + ", ".join(f"{r['id']} 声明{r['manifest_width']}x{r['manifest_height']} 实测{r['width']}x{r['height']}" for r in dim_bad_foundation) if dim_bad_foundation else "。"))
    a(f"- 尺寸不符（validation100/spot100）：{len(dim_bad_other)} 张，**全部属预期**——这两组清单的 "
      "width/height 是图纸格子数（如 M001 为 61x44 格），不是图片像素，与 PIL 实测像素天然不等；"
      "逐张数值在 inventory.json 的 `manifest_width/height` 与 `width/height` 字段，不在此逐条罗列。")
    a(f"- 无清单声明尺寸（`dims_match=null`）：{dict(dim_null)}"
      "（new37 全部无声明；validation100 的 40 张石弦/pixelbead.art 记录无 width/height 字段）。")
    a("")

    a("## URL 可达性汇总")
    a("")
    if not url_results:
        a("尚未运行 URL 检查（先跑 `build_inventory.py urlcheck` 再重新 `build`）。")
    else:
        iu_statuses = Counter()
        sp_statuses = Counter()
        for r in inventory:
            uc = r.get("url_check")
            if uc is None:
                continue
            iu_statuses[str(uc["imageUrl_status"])] += 1
            sp_statuses[str(uc["sourcePage_status"])] += 1
        a(f"共检查 {len(url_results)} 个去重 URL（HEAD，失败时最小 GET；逐条间隔 1 秒；遇 429 即停）。")
        a("")
        a("| URL 类型 | 状态码 | 张数 |")
        a("| --- | --- | ---: |")
        for k, n in sorted(iu_statuses.items()):
            a(f"| imageUrl | {k} | {n} |")
        for k, n in sorted(sp_statuses.items()):
            a(f"| sourcePage | {k} | {n} |")
        a("")
        unchecked = [r["id"] for r in inventory
                     if r.get("url_check") and r["url_check"]["checked_at"] is None]
        if unchecked:
            a(f"以下 {len(unchecked)} 张的 URL 未查到（限流停止或尚未检查）：{', '.join(unchecked)}")
            a("")
    a("foundation 19 张无 imageUrl/sourcePage，`url_check=null`。")
    a("")

    a("## 异常与未核实事项")
    a("")
    if site_notes:
        for note, n in site_notes.items():
            a(f"- （{n} 张）{note}")
    if anomalies:
        for x in anomalies:
            a(f"- {x}")
    a("- S03–S15 的 webp 文件名形如「时间戳_UUID_数字ID_宽x高.webp」，看起来像社交平台（小红书）缓存命名，"
      "但清单只写「用户提供的仓内原文件」，**未核实**具体来源页，site 统一记 `用户提供`。")
    a("- 本次生成时 spot100 清单 `site` 字段（石弦 80 + BitBead 20）与 sourcePage 域名完全一致，"
      "无冲突。注意：本任务进行期间主工作区的登记清单正被其他会话改动"
      "（曾观察到该文件 site 字段短暂不一致），本清单以生成时刻的文件内容为准。")
    a("- foundation 的 `reference_status` 字段在样本清单里多为 `unknown`，而参考答案文件 "
      "references-v05.json 里 S01–S18 已有 status（17 complete + 1 partial）；本清单 `reference_status` "
      "取参考答案文件原值。两处登记口径不同，未修改任何一方。")
    a("- S00 是 MARD221 色卡负样例（kind=color-card），无参考答案、无 expected；"
      "CSV 中 status=failed、paletteRejected=true，属预期的负样例行为。")
    a("- validation100 有 2 张（见 CSV failed）与 spot100 有 3 张 failed、foundation S00 failed，"
      "均为旧算法运行状态原值，与文件完整性无关。")
    a("- URL 检查只代表检查时刻的可达性；`error:...` 为网络层错误（超时/拒绝等），不等于资源不存在。")
    a("- 石弦 114 条 `imageUrl`（`wp-json/b2/v1/downloadOffline` 接口）全部 404：HEAD 与最小 GET 均 404，"
      "响应体为 WordPress `rest_no_route`（「未找到匹配 URL 和请求方式的路由」），即该下载接口路由已不存在；"
      "对应 114 条 `sourcePage`（/pattern/<id> 页面）全部 200。图片副本早已落地，不影响本数据集使用，"
      "但意味着无法再从该接口重新下载原图。")
    a("- BitBead 有 2 张图（imageUrl 与 sourcePage 均 404，共 4 个 URL）：对应页面已删除，见清单中 "
      "status=404 的记录。")
    a("")
    a("## 字段口径速查")
    a("")
    a("- `bytes`：副本文件实测字节数（与 copy-report 登记核对）。")
    a("- `format/width/height`：PIL 实测；`manifest_width/height`：清单声明（无则 null）。")
    a("- `dims_match`：仅在清单声明与实测都存在时比较；validation100/spot100 声明是格子数，预期 false。")
    a("- `creator` 照抄原值；`creator_norm` 归一；`brand` 仅 validation100/spot100 有，其余 null。")
    a("- `reference_color_count` = expected 色号个数；`reference_total` = expected 数量合计；"
      "`reference_unknown` = unknown 数组长度；无参考答案则三者 null。")
    a("- `old_algo_within_tolerance`：CSV `outsideTolerance` 为空/`{}` → true。")
    a("")

    with open(INVENTORY_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "build"
    if mode in ("urlcheck", "all"):
        samples_by_group = {}
        for group, rel in MANIFESTS.items():
            data = load_json(rel)
            samples_by_group[group] = data["samples"] if isinstance(data, dict) else data
        run_url_check(samples_by_group)
    if mode in ("build", "all"):
        build()
    if mode not in ("urlcheck", "build", "all"):
        print(f"未知模式 {mode!r}，用法：urlcheck | build | all", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
