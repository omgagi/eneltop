#!/usr/bin/env python3
"""Refresh verified editorial profile photos from their Feedspot listings."""

import io
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCES = json.loads((ROOT / "scripts/editorial_social_sources.json").read_text())
OUTPUT = ROOT / "assets/social"
OUTPUT.mkdir(parents=True, exist_ok=True)


def download(item):
    handle, url = item
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        raw = response.read(4_000_000)
        if not response.headers.get("Content-Type", "").startswith("image/"):
            raise ValueError(f"{handle}: response was not an image")
    with Image.open(io.BytesIO(raw)) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        if min(image.size) < 96:
            raise ValueError(f"{handle}: image too small ({image.size})")
        image = ImageOps.fit(image, (256, 256), method=Image.Resampling.LANCZOS)
        image.save(OUTPUT / f"{handle}.jpg", "JPEG", quality=84, optimize=True)
    return handle


with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {pool.submit(download, item): item[0] for item in SOURCES.items()}
    failed = []
    for future in as_completed(futures):
        try:
            print(f"OK {future.result()}")
        except Exception as exc:
            failed.append(f"{futures[future]}: {exc}")
    if failed:
        raise SystemExit("\n".join(failed))
