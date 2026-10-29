"""Search YouTube (Creative Commons filter) via yt-dlp and fetch candidate thumbnails.

Usage: uv run --no-project --with pillow python fetch_thumbs.py <staging_dir>
"""
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

YT = str(Path(__file__).with_name("yt.sh"))
CC_FILTER = "EgIwAQ%3D%3D"  # YouTube search filter: Creative Commons
PER_QUERY = 6

CATEGORIES = {
    "cartoon": ["cartoon animation short film", "anime illustration lofi"],
    "portrait": ["portrait photography", "studio headshot"],
    "pet": ["cute cat", "puppy dog"],
    "landscape": ["landscape nature 4k", "sunset beach"],
    "text": ["typography lettering", "neon sign"],
    "pixel": ["pixel art", "8-bit game"],
    "ai": ["AI generated art", "stable diffusion art"],
}


def search(query: str) -> list[dict]:
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode(
        {"search_query": query}) + "&sp=" + CC_FILTER
    out = subprocess.run(
        [YT, "--flat-playlist", "--playlist-end", str(PER_QUERY), "-J", url],
        capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        print("search failed:", query, out.stderr[-300:], file=sys.stderr)
        return []
    return [e for e in json.loads(out.stdout).get("entries", []) if e.get("id")]


def fetch(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        dest.write_bytes(data)
        with Image.open(dest) as im:
            return im.width >= 640
    except Exception as exc:  # noqa: BLE001
        print("fetch failed:", url, exc, file=sys.stderr)
        return False


def contact_sheet(items: list[dict], dest: Path) -> None:
    tw, th, cols = 320, 180, 4
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 18)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, it in enumerate(items):
        with Image.open(it["file"]) as im:
            im = im.convert("RGB").resize((tw, th))
        x, y = (i % cols) * tw, (i // cols) * (th + 18)
        sheet.paste(im, (x, y))
        draw.text((x + 4, y + th + 2), f"#{i} {it['id']}", fill="black")
    sheet.save(dest, quality=85)


def main() -> None:
    staging = Path(sys.argv[1])
    staging.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for cat, queries in CATEGORIES.items():
        seen, items = set(), []
        for q in queries:
            for e in search(q):
                if e["id"] in seen:
                    continue
                seen.add(e["id"])
                dest = staging / cat / f"{e['id']}.jpg"
                dest.parent.mkdir(exist_ok=True)
                urls = [f"https://i.ytimg.com/vi/{e['id']}/maxresdefault.jpg"]
                urls += [t["url"] for t in reversed(e.get("thumbnails") or [])]
                if not any(fetch(u, dest) for u in urls):
                    dest.unlink(missing_ok=True)
                    continue
                items.append({
                    "id": e["id"], "file": str(dest), "query": q,
                    "title": e.get("title"), "channel": e.get("channel") or e.get("uploader"),
                    "url": f"https://www.youtube.com/watch?v={e['id']}",
                })
        manifest[cat] = items
        if items:
            contact_sheet(items, staging / f"sheet_{cat}.jpg")
        print(cat, len(items))
    (staging / "candidates.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
