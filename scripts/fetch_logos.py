"""Download a cached 128px favicon for each editorial listing.

Run from the project root. Google S2 provides favicon images for public domains;
the site serves the downloaded files locally and keeps a text fallback.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
import re
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets" / "logos"
DEST.mkdir(parents=True, exist_ok=True)
urls = re.findall(r"url:'([^']+)'", (ROOT / "data.js").read_text())


def normalize(image):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox and bbox != (0, 0, *image.size):
        image = image.crop(bbox)
    else:
        pixels = image.load()
        visible = [(x, y) for y in range(image.height) for x in range(image.width)
                   if pixels[x, y][3] > 16 and min(pixels[x, y][:3]) < 242]
        if visible:
            xs, ys = zip(*visible)
            image = image.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    image.thumbnail((112, 112), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (128, 128), (255, 255, 255, 0))
    output.alpha_composite(image, ((128 - image.width) // 2, (128 - image.height) // 2))
    return output


def fetch(item):
    number, site_url = item
    domain = urlparse(site_url).hostname
    target = DEST / f"{number:02d}.png"
    sources = [
        f"https://www.google.com/s2/favicons?domain={quote(domain)}&sz=128",
        f"https://icons.duckduckgo.com/ip3/{domain}.ico",
        f"https://{domain}/favicon.ico",
    ]
    parent_domain = ".".join(domain.split(".")[-2:])
    if parent_domain != domain:
        sources.append(f"https://icons.duckduckgo.com/ip3/{parent_domain}.ico")
    last_error = None
    for source in sources:
        try:
            request = Request(source, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=12) as response:
                data = response.read()
            if len(data) > 1_000_000:
                raise ValueError("Icono demasiado grande")
            image = Image.open(BytesIO(data)).convert("RGBA")
            if min(image.size) < 16:
                raise ValueError("Icono demasiado pequeño")
            normalize(image).save(target, format="PNG", optimize=True)
            return number, domain, target.stat().st_size
        except Exception as exc:
            last_error = exc
    raise last_error


with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {pool.submit(fetch, item): item for item in enumerate(urls, 1)}
    failures = []
    for future in as_completed(futures):
        try:
            future.result()
        except Exception as exc:
            failures.append((futures[future], str(exc)))

print(f"Descargados: {len(urls) - len(failures)}/{len(urls)}")
for (number, url), reason in sorted(failures):
    print(f"{number:02d} {url}: {reason}")
