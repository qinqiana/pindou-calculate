#!/usr/bin/env python3
"""真图数据集切分与冻结（Issue #26）。

用法（在仓库根目录）：
    python3 experiments/issue18/real-dataset/split.py \
        --inventory experiments/issue18/real-dataset/inventory.json \
        --out experiments/issue18/real-dataset/manifest-v1.json

输入：build_inventory.py 产出的 inventory.json（256 条，每张已登记真图一条）。
输出：冻结清单 manifest-v1.json。只读输入、只写输出；不复制、不下载、不改图片。

切分策略 v1（依据 Issue #23「许可与训练数据合规边界」九条规则与地图 #19 的已裁决事项）：
1. 许可状态决定能否用于训练：只有 license_status ∈ {user_provided, permission_confirmed} 的图允许进微调组；
   社交平台截图（小红书等）与工具/图库站（BitBead、石弦、pixelbead.art）默认只进验证或测试组；
   foundation 组的「用户提供的仓内原文件」登记原文自述「非版权或出处认证」，同样默认不允许训练。
   若日后确认归属或取得书面许可，写入 permissions.json（{"user_owned_ids": [...], "source_groups": [...], "sites": [...]}）即可放开，不改脚本。
   因此 v1 的微调组预期为空：真图训练价值先由合成数据承担，这与地图 #19 的裁决一致。
2. 同一来源组（source_group）永不跨组：作者已知按作者分组；作者未知的站点按图案/帖子编号分组，
   并在 README 里说明这类站点的验证/测试切分不代表跨作者泛化——跨作者泛化由留出来源组衡量。
3. 留出来源组（heldout）= 整个来源只进测试、从不进验证：pixelbead.art 全部（16 张，右侧数字排版），以及 foundation 中的
   bead-pixel / rounded-below 两个模板组（6 张，色块内色号、数量在下）。compact-right（5 张，右侧数字）留在验证组，
   保证每类排版在验证组至少有真图样本。清单里没有小红书来源的登记（new37 的来源页经域名推断全部是 BitBead / pixelbead.art），
   若日后登记到小红书截图，同样整体留出。
4. 148 颗用户样例（S18）是根规格的验收锚点，其所在 douhua 模板组（7 张）整体进验证组、不进微调组；色卡负样例 S00 固定进测试组作为负例。
5. 其余（BitBead、石弦）按来源组以固定随机种子对半分到验证/测试，并保证两个站点在两侧都出现。
6. 冻结：本脚本输出即定案；后续新增图只能进新的追加清单，不回改历史分母。旧的四个冻结组标签（foundation/new37/validation100/spot100）
   与 pure_mard221 标记原样保留，用于「不退步」比较。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

POLICY_VERSION = "v1"
SEED = 20260928
ANCHOR_VALIDATION_IDS = {"S18"}  # 148 颗用户样例：验收锚点，固定验证组
NEGATIVE_IDS = {"S00"}  # 色卡负样例：固定测试组
HELDOUT_SITES = {"pixelbead.art", "小红书"}
# foundation 组里整体留出的模板组：bead-pixel / rounded-below（色块内色号、数量在下）。
# compact-right（右侧数字，5 张）留在验证组，让每类排版在验证组至少有真图样本；右侧数字的「没见过的来源」由 pixelbead.art 承担。
HELDOUT_GROUPS = {"bead-pixel", "rounded-below"}
VALIDATION_GROUPS = {"compact-right"}  # 显式固定，不依赖贪心分配的先后
MARD_CSV = "research/MARD221-参考色值-社区来源.csv"
FOUNDATION_REFS = "experiments/issue8/references-v05.json"
SITE_ALIASES = {
    "sxgrocery.com": "石弦",
    "石弦": "石弦",
    "bitbead": "BitBead",
    "BitBead": "BitBead",
    "pixelbead.art": "pixelbead.art",
    "xiaohongshu": "小红书",
    "xhs": "小红书",
    "小红书": "小红书",
    "用户提供": "用户提供",
}


def norm_site(value):
    if value is None:
        return None
    s = str(value).strip()
    for key, canon in SITE_ALIASES.items():
        if key.lower() in s.lower():
            return canon
    return s


def license_status(item, permissions):
    site = item["site_norm"]
    if item["id"] in permissions.get("user_owned_ids", []):
        return "user_provided"
    if item["source_group"] in permissions.get("source_groups", []) or site in permissions.get("sites", []):
        return "permission_confirmed"
    if site == "用户提供":
        # foundation 组登记原文：「用户提供的仓内原文件……非版权或出处认证」——只是用户放进仓库，
        # 不等于用户创作或已获授权，因此默认不允许训练；确认归属后写入 permissions.json 的 user_owned_ids。
        return "repo_provided_unverified"
    if site == "小红书":
        return "social_screenshot"
    if site in {"BitBead", "石弦", "pixelbead.art"}:
        return "tool_site_unverified"
    return "unknown"


def group_key(item):
    """来源组键：作者已知按作者；未知按图案/帖子编号；再没有就按 inventory 给的 source_group。"""
    sg = item.get("source_group")
    creator = (item.get("creator_norm") or "").strip()
    site = item["site_norm"] or "unknown"
    if creator and creator.lower() not in {"none", "null", "unknown", "未知"}:
        return f"{site}/{creator}"
    for key in ("patternId", "postId", "uuid"):
        if item.get(key):
            return f"{site}/{key}:{item[key]}"
    return sg or f"{site}/{item['id']}"


def load_mard_codes(path):
    import csv, io
    lines = [l for l in Path(path).read_text(encoding="utf-8").splitlines(True) if not l.startswith("#")]
    return {r["code"].strip() for r in csv.DictReader(io.StringIO("".join(lines))) if r.get("code")}


def foundation_purity(refs_path, mard_codes):
    """foundation 清单没有 outsideCatalog 字段：用参考答案里的色号对照 MARD 221 色号表补算 pure_mard221。"""
    refs = json.loads(Path(refs_path).read_text(encoding="utf-8"))
    refs = refs.get("samples", refs)  # references-v05.json 的答案挂在 samples 键下
    out = {}
    for sid, ref in refs.items():
        if not isinstance(ref, dict):
            continue
        expected = ref.get("expected") or {}
        if not expected:
            continue
        outside = sorted(c for c in expected if c not in mard_codes)
        out[sid] = {"pure": not outside, "outside": outside}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--permissions", default=None, help="可选：已取得许可的来源，JSON {user_owned_ids:[], sites:[], source_groups:[]}")
    ap.add_argument("--mard-csv", default=MARD_CSV)
    ap.add_argument("--foundation-refs", default=FOUNDATION_REFS)
    args = ap.parse_args()
    purity = foundation_purity(args.foundation_refs, load_mard_codes(args.mard_csv))

    inv = json.loads(Path(args.inventory).read_text(encoding="utf-8"))
    permissions = json.loads(Path(args.permissions).read_text(encoding="utf-8")) if args.permissions else {}

    items = []
    for raw in inv:
        item = dict(raw)
        item["site_norm"] = norm_site(raw.get("site"))
        item["source_group_key"] = group_key(item)
        item["license_status"] = license_status(item, permissions)
        item["train_allowed"] = item["license_status"] in {"user_provided", "permission_confirmed"}
        if item.get("pure_mard221") is None and item["id"] in purity:
            item["pure_mard221"] = purity[item["id"]]["pure"]
            item["outside_catalog"] = purity[item["id"]]["outside"]
            item["pure_mard221_source"] = "computed_from_reference"
        items.append(item)

    # 1) 固定分配（按来源组整体决定，保证同组同侧）
    groups_all: dict[str, list] = defaultdict(list)
    for it in items:
        groups_all[it["source_group_key"]].append(it)
    forced: dict[str, str] = {}
    for key, members in groups_all.items():
        ids = {m["id"] for m in members}
        sites = {m["site_norm"] for m in members}
        raw_groups = {m.get("source_group") for m in members}  # inventory 原始来源组（foundation 的模板组名）
        if ids & NEGATIVE_IDS:
            forced[key] = "test"
        elif ids & ANCHOR_VALIDATION_IDS:
            forced[key] = "validation"
        elif sites & HELDOUT_SITES or key in HELDOUT_GROUPS or raw_groups & HELDOUT_GROUPS:
            forced[key] = "test"
        elif key in VALIDATION_GROUPS or raw_groups & VALIDATION_GROUPS:
            forced[key] = "validation"
        elif all(m["train_allowed"] for m in members):
            forced[key] = "finetune"
    assignment: dict[str, str] = {}
    for it in items:
        if not it.get("opens_ok", True):
            assignment[it["id"]] = "excluded"
        elif it["source_group_key"] in forced:
            assignment[it["id"]] = forced[it["source_group_key"]]

    # 2) 其余按来源组对半分（BitBead / 石弦 / 其他）
    remaining = [it for it in items if it["id"] not in assignment]
    by_site_group: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for it in remaining:
        by_site_group[it["site_norm"] or "unknown"][it["source_group_key"]].append(it)
    rng = random.Random(SEED)
    for site in sorted(by_site_group):
        groups = by_site_group[site]
        keys = sorted(groups)
        rng.shuffle(keys)
        # 按图数贪心分配，使两侧张数接近
        counts = {"validation": 0, "test": 0}
        for k in keys:
            side = "validation" if counts["validation"] <= counts["test"] else "test"
            for it in groups[k]:
                assignment[it["id"]] = side
            counts[side] += len(groups[k])

    # 3) 汇总
    for it in items:
        it["split"] = assignment[it["id"]]
        it["heldout_source"] = (
            it["site_norm"] in HELDOUT_SITES or it["source_group_key"] in HELDOUT_GROUPS or it.get("source_group") in HELDOUT_GROUPS
        ) and it["id"] not in NEGATIVE_IDS
        it["role"] = "negative" if it["id"] in NEGATIVE_IDS else "pattern"

    summary = {
        "by_split": dict(Counter(it["split"] for it in items)),
        "by_split_site": {},
        "by_license_status": dict(Counter(it["license_status"] for it in items)),
        "heldout_source_images": sum(1 for it in items if it["heldout_source"]),
        "source_groups": len({it["source_group_key"] for it in items}),
        "pure_mard221_by_split": {},
        "reference_complete_by_split": {},
        "frozen_group_labels": dict(Counter(it["group"] for it in items)),
    }
    for split in sorted(summary["by_split"]):
        sub = [it for it in items if it["split"] == split]
        summary["by_split_site"][split] = dict(Counter(it["site_norm"] or "unknown" for it in sub))
        summary["pure_mard221_by_split"][split] = sum(1 for it in sub if it.get("pure_mard221"))
        summary["reference_complete_by_split"][split] = sum(1 for it in sub if it.get("reference_complete"))

    # 不跨组自检
    sides = defaultdict(set)
    for it in items:
        if it["split"] in {"finetune", "validation", "test"}:
            sides[it["source_group_key"]].add(it["split"])
    leaks = {k: sorted(v) for k, v in sides.items() if len(v) > 1}
    assert not leaks, f"来源组跨侧: {leaks}"

    inv_digest = hashlib.sha256(Path(args.inventory).read_bytes()).hexdigest()[:16]
    manifest = {
        "policy_version": POLICY_VERSION,
        "seed": SEED,
        "frozen_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "inventory_digest": inv_digest,
        "image_root": "dist/.datasets/pindou-real/originals（不进 Git；按 imageUrl 可重取）",
        "rules": [
            "只有 user_provided / permission_confirmed 的图进微调组；其余只进验证或测试",
            "同一来源组不跨组；作者未知的站点按图案/帖子编号分组，其验证/测试切分不代表跨作者泛化",
            "留出来源组只进测试、从不进验证：pixelbead.art 全部 + foundation 的 bead-pixel / rounded-below 模板组；用来衡量对没见过来源的泛化；compact-right 显式固定在验证组，使右侧数字排版有真图验证样本",
            "S18（148 颗用户样例）所在 douhua 模板组整体进验证组作验收锚点；S00 色卡负样例固定测试组",
            "foundation 的 pure_mard221 由参考答案色号对照 MARD 221 色号表补算（pure_mard221_source=computed_from_reference）",
            "旧冻结组标签与 pure_mard221 原样保留，用于不退步比较",
            "本清单即冻结；后续新增图进追加清单，不回改分母",
        ],
        "summary": summary,
        "items": [
            {
                "id": it["id"],
                "group": it["group"],
                "role": it["role"],
                "split": it["split"],
                "heldout_source": it["heldout_source"],
                "site": it["site_norm"],
                "source_group": it["source_group_key"],
                "license_status": it["license_status"],
                "train_allowed": it["train_allowed"],
                "layout_norm": it.get("layout_norm"),
                "pure_mard221": it.get("pure_mard221"),
                "pure_mard221_source": it.get("pure_mard221_source", "manifest"),
                "outside_catalog": it.get("outside_catalog"),
                "reference_complete": it.get("reference_complete"),
                "reference_color_count": it.get("reference_color_count"),
                "reference_total": it.get("reference_total"),
                "old_algo_status": it.get("old_algo_status"),
                "copy_path": it.get("copy_path"),
                "imageUrl": it.get("imageUrl"),
                "sourcePage": it.get("sourcePage"),
                "width": it.get("width"),
                "height": it.get("height"),
                "bytes": it.get("bytes"),
            }
            for it in sorted(items, key=lambda x: (x["group"], x["id"]))
        ],
    }
    Path(args.out).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
