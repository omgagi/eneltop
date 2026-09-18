"""Discover and cache brand logos exposed by each listed website.

The generated manifest records the exact source URL. Sites without a discoverable
logo keep their favicon, which is labelled as such in the manifest.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
import json
import re

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "brands"
OUT.mkdir(parents=True, exist_ok=True)
URLS = re.findall(r"url:'([^']+)'", (ROOT / "data.js").read_text())
NAMES = re.findall(r"name:'([^']+)'", (ROOT / "data.js").read_text())


def key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def get(url, max_bytes=2_000_000):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; EnelTopBrandBot/1.0)"})
    with urlopen(req, timeout=12) as response:
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError("asset too large")
        return data, response.headers.get("Content-Type", "")


class BrandParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.candidates = []
        self.scripts = []
        self.in_jsonld = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and "ld+json" in attrs.get("type", ""):
            self.in_jsonld = True
        if tag == "img":
            src = attrs.get("src") or attrs.get("data-src")
            alt = attrs.get("alt", "").lower()
            if src and ("logo" in alt or "logo" in src.lower()):
                self.candidates.append((src, alt))

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_jsonld = False

    def handle_data(self, data):
        if self.in_jsonld:
            self.scripts.append(data)


def schema_logos(value):
    if isinstance(value, list):
        for item in value:
            yield from schema_logos(item)
    elif isinstance(value, dict):
        kind = value.get("@type", "")
        if isinstance(kind, list):
            kind = " ".join(kind)
        if any(word in str(kind).lower() for word in ("organization", "corporation", "brand")):
            logo = value.get("logo")
            if isinstance(logo, str):
                yield logo, value.get("name", "")
            elif isinstance(logo, dict) and isinstance(logo.get("url"), str):
                yield logo["url"], value.get("name", "")
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from schema_logos(child)


def fetch_one(item):
    number, site_url = item
    brand = key(NAMES[number - 1].split(' en español')[0].split(' Español')[0].split(' · ')[0])
    brand = brand[:24]
    site_host = urlparse(site_url).hostname or ""
    fallback = {"asset": f"assets/logos/{number:02d}.png", "type": "favicon", "source": site_url}
    try:
        html, _ = get(site_url, 4_000_000)
        parser = BrandParser()
        parser.feed(html.decode("utf-8", "ignore"))
        candidates = []
        for raw in parser.scripts:
            try:
                candidates.extend((url, name, True) for url, name in schema_logos(json.loads(raw)))
            except (ValueError, TypeError):
                pass
        candidates.extend((url, alt, False) for url, alt in parser.candidates)
        seen = set()
        for candidate, label, from_schema in candidates:
            logo_url = urljoin(site_url, candidate)
            if logo_url in seen or urlparse(logo_url).scheme not in ("http", "https"):
                continue
            seen.add(logo_url)
            path = urlparse(logo_url).path.lower()
            if any(part in path for part in ('white', 'blanco', 'light')):
                continue
            image_host = urlparse(logo_url).hostname or ""
            own_host = image_host == site_host or image_host.endswith('.' + site_host.lstrip('www.'))
            matches_brand = brand in key(path) or brand in key(label)
            generic_own_logo = own_host and (path.endswith('/logo.svg') or path.endswith('/logo.png') or path.endswith('/logo.webp'))
            if 'logo' not in key(path):
                continue
            if from_schema and not matches_brand:
                continue
            if not from_schema and not (matches_brand or generic_own_logo):
                continue
            try:
                data, content_type = get(logo_url)
                is_svg = b"<svg" in data[:1000] and ("svg" in content_type or logo_url.lower().endswith(".svg"))
                if is_svg:
                    extension = "svg"
                    match = re.search(rb'viewBox="[\d.\s]+\s([\d.]+)\s([\d.]+)"', data[:1000])
                    ratio = float(match.group(1)) / float(match.group(2)) if match else 1
                else:
                    image = Image.open(BytesIO(data))
                    if min(image.size) < 32:
                        continue
                    ratio = image.width / image.height
                    extension = "png"
                    output = BytesIO()
                    image.convert("RGBA").save(output, format="PNG", optimize=True)
                    data = output.getvalue()
                target = OUT / f"{number:02d}.{extension}"
                target.write_bytes(data)
                return number, {"asset": f"assets/brands/{target.name}", "type": "logo", "source": logo_url, "wide": ratio > 2.2}
            except Exception:
                continue
    except Exception:
        pass
    return number, fallback


with ThreadPoolExecutor(max_workers=8) as pool:
    results = dict(future.result() for future in as_completed(
        [pool.submit(fetch_one, item) for item in enumerate(URLS, 1)]))

manifest = [results[i] for i in range(1, len(URLS) + 1)]
(ROOT / "brand-assets.js").write_text("const brandAssets = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n")
print(f"Logos oficiales: {sum(item['type'] == 'logo' for item in manifest)}/{len(manifest)}")
