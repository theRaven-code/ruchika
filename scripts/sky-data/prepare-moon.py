"""Crops the full-Moon photo used for the Moon disc into public/sky/moon.jpg.

    python3 scripts/sky-data/prepare-moon.py

Source: "FullMoon2010.jpg" by Gregory H. Revera, CC BY-SA 3.0,
https://commons.wikimedia.org/wiki/File:FullMoon2010.jpg
"""

from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".cache/sky-raw/moon/FullMoon2010_1280.jpg"
OUT = ROOT / "public/sky/moon.jpg"
URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/1280px-FullMoon2010.jpg"

if not RAW.exists():
    RAW.parent.mkdir(parents=True, exist_ok=True)
    request = Request(URL, headers={"User-Agent": "ruchika-sky-data/1.0"})
    RAW.write_bytes(urlopen(request).read())

image = Image.open(RAW).convert("RGB")
x0, y0, x1, y1 = image.convert("L").point(lambda v: 255 if v > 40 else 0).getbbox()
cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) / 2
disc = image.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r)))
disc.resize((512, 512), Image.LANCZOS).save(OUT, quality=88)
print(f"wrote {OUT.relative_to(ROOT)}")
