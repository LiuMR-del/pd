"""Copy selected candidate thumbnails into the bench image set with a license manifest.

Usage: uv run --no-project --with pillow python install_picks.py <staging_dir> <dest_dir>
"""
import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image

# (category, source_category_in_staging, youtube_id, crop_center_portrait, note)
PICKS = [
    ("cartoon", "cartoon", "JOhiWY7XmoY", False, "Blender 开源动画 Caminandes，三维卡通 + 文字标题"),
    ("cartoon", "cartoon", "CAYDRIbXFAc", False, "扁平插画，多人物、蓝粉配色"),
    ("cartoon", "cartoon", "iS7brQUv_tQ", False, "高饱和水果插画，渐变背景"),
    ("cartoon", "cartoon", "Oqu0ORWc-2U", False, "粗描线扁平人物 + 大标题字"),
    ("portrait", "portrait", "r2conU-Qaf0", False, "人像，金发，背景虚化"),
    ("portrait", "portrait", "ZTCEJSWulbo", False, "证件照式人像，纯色背景（去背景测试）"),
    ("portrait", "portrait", "PjX06g1ZvYQ", False, "男性人像，胡须与格子衬衫纹理"),
    ("pet", "pet", "sZHtchTlOKc", False, "多只小猫，毛发细节"),
    ("pet", "pet", "Grww7HKBtlc", False, "小猎犬，草地背景"),
    ("pet", "pet", "Zc56bFqSeDI", False, "幼犬特写，左右黑边"),
    ("landscape", "landscape", "AFikfSl1Xl0", False, "雪山森林，细节多"),
    ("landscape", "landscape", "SecjIRmtSPM", False, "日落剪影，大面积橙色渐变（色带测试）"),
    ("landscape", "landscape", "0NBs-NsROdk", False, "码头粉色天空，柔和渐变"),
    ("text", "text", "im8Mm3e3SRs", False, "黑白字母组合 Logo，白底（描线测试）"),
    ("text", "text", "0Oxr1KAoPLA", False, "深蓝底多字体文字"),
    ("text", "text", "7LpjblE5-R8", False, "霓虹灯 CLOSED，发光边缘"),
    ("pixel", "pixel", "5bn3Jmvep1k", False, "像素风幻想场景（周期检测测试）"),
    ("pixel", "pixel", "SoZhpnTuQBo", False, "像素星星 + 文字，黄白配色"),
    ("pixel", "pixel", "sx665YgtZVQ", False, "像素角色设计稿 + 标题"),
    ("ai", "pet", "1-fe7VHSDN4", True, "推测为 AI 生成：拟人小猫三维风格（竖屏，已裁中间）"),
    ("ai", "pet", "B5XfjU3Aja0", True, "推测为 AI 生成：穿衣黑猫三维风格（竖屏，已裁中间）"),
    ("ai", "ai", "dOsNAb-ML_o", False, "AI 绘画红发动漫人物 + 大字标题"),
]

LICENSE_RE = re.compile(r"Creative Commons[^\"]{0,60}")


def youtube_license(vid: str) -> str:
    req = urllib.request.Request(
        f"https://www.youtube.com/watch?v={vid}",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "ignore")
    m = LICENSE_RE.search(html)
    return m.group(0) if m else ""


def main() -> None:
    staging, dest = Path(sys.argv[1]), Path(sys.argv[2])
    meta = {it["id"]: it for items in json.loads(
        (staging / "candidates.json").read_text(encoding="utf-8")).values() for it in items}
    dest.mkdir(parents=True, exist_ok=False)
    rows, counters = [], {}
    for cat, src_cat, vid, crop, note in PICKS:
        lic = youtube_license(vid)
        if not lic:
            print("SKIP (license not verified):", vid)
            continue
        counters[cat] = counters.get(cat, 0) + 1
        name = f"{cat}_{counters[cat]:02d}_{vid}.png"
        with Image.open(staging / src_cat / f"{vid}.jpg") as im:
            im = im.convert("RGB")
            if crop:
                w = round(im.height * 9 / 16)
                left = (im.width - w) // 2
                im = im.crop((left, 0, left + w, im.height))
            im.save(dest / name)
            size = f"{im.width}x{im.height}"
        m = meta[vid]
        rows.append({
            "file": name, "category": cat, "size": size, "note": note,
            "source_title": m["title"], "author_channel": m["channel"], "source_url": m["url"],
            "license": lic, "license_url": "https://creativecommons.org/licenses/by/3.0/",
        })
        print("ok", name, size, lic)
    with (dest / "manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
