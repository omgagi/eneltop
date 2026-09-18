"""Fetch public profile images for Instagram and TikTok accounts.

Instagram may require login for profile pages. A matching Linktree profile is used
only when its title names the listed account. TikTok avatars come from public
profile metadata. Every source is recorded.
"""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
import json
import re
import subprocess

from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "social"
OUT.mkdir(parents=True, exist_ok=True)
DATA = (ROOT / "data.js").read_text()
ENTRIES = re.findall(r"name:'([^']+)'.*?url:'([^']+)'", DATA)


class ProfileParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.in_title = False
        self.image = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "img" and attrs.get("data-testid") == "ProfileImage":
            self.image = attrs.get("src")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def get(url):
    result = subprocess.run(
        ["curl", "-L", "--fail", "--silent", "--show-error", "--max-time", "15", "-A", "Mozilla/5.0", url],
        check=True, capture_output=True, timeout=18,
    )
    return result.stdout[:3_000_000]


manifest = {}
for name, url in ENTRIES:
    parsed = urlparse(url)
    if parsed.hostname in ("www.tiktok.com", "tiktok.com"):
        handle = parsed.path.strip("/").split("/")[0].lstrip("@")
        if not handle:
            continue
        try:
            page = get(url).decode("utf-8", "ignore")
            profile_handle = re.search(r'"uniqueId":"([^"]+)"', page)
            avatar = re.search(r'"avatarLarger":"([^"]+)"', page)
            if not profile_handle or profile_handle.group(1).lower() != handle.lower() or not avatar:
                continue
            image_url = json.loads('"' + avatar.group(1) + '"')
            image = Image.open(BytesIO(get(image_url))).convert("RGB")
            if min(image.size) < 96:
                continue
            target = OUT / f"{handle}.jpg"
            image.save(target, quality=90, optimize=True)
            manifest[handle] = {"asset": f"assets/social/{target.name}", "source": image_url, "profile": url}
        except Exception:
            continue
        continue
    if parsed.hostname not in ("www.instagram.com", "instagram.com"):
        continue
    handle = parsed.path.strip("/").split("/")[0]
    if not handle:
        continue
    profile_url = f"https://linktr.ee/{handle}"
    try:
        parser = ProfileParser()
        parser.feed(get(profile_url).decode("utf-8", "ignore"))
        brand = re.sub(r"[^a-z0-9]", "", name.lower())
        title = re.sub(r"[^a-z0-9]", "", parser.title.lower())
        if not parser.image or brand not in title:
            continue
        image = Image.open(BytesIO(get(parser.image))).convert("RGB")
        if min(image.size) < 96:
            continue
        target = OUT / f"{handle}.jpg"
        image.save(target, quality=90, optimize=True)
        manifest[handle] = {"asset": f"assets/social/{target.name}", "source": parser.image, "profile": profile_url}
    except Exception:
        continue

(ROOT / "social-assets.js").write_text("const socialAssets = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n")
print(f"Fotos de perfil: {len(manifest)}")
