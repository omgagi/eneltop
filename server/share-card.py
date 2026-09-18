#!/usr/bin/env python3
"""Render a paid project's social card as a PNG on stdout."""

import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps


data = json.load(sys.stdin)
name = str(data["name"])[:50]
category = str(data["category"])[:40]
rank = int(data["rank"])
avatar_path = str(data.get("avatarPath") or "")

FONT_PATHS = [
    "/usr/share/fonts/truetype/lato/Lato-Heavy.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def font(size):
    for path in FONT_PATHS:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def fit_font(text, max_width, initial_size, minimum_size=30):
    for size in range(initial_size, minimum_size - 1, -2):
        candidate = font(size)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
    return font(minimum_size)


canvas = Image.new("RGB", (1200, 630), "#f8fafc")
draw = ImageDraw.Draw(canvas)
navy = "#1d2a3d"
coral = "#bd503f"
teal = "#17576c"
muted = "#607186"

draw.rounded_rectangle((28, 28, 1172, 602), radius=42, fill="#ffffff", outline="#dbe4ed", width=2)
draw.rounded_rectangle((62, 62, 1138, 568), radius=28, fill="#f2f8fb")
draw.rounded_rectangle((64, 64, 1136, 192), radius=27, fill=navy)

# eneltop mark
draw.rounded_rectangle((105, 111, 143, 120), radius=4, fill="#ffffff")
draw.rounded_rectangle((115, 96, 143, 105), radius=4, fill=coral)
draw.rounded_rectangle((98, 126, 143, 135), radius=4, fill="#ffffff")
draw.text((161, 92), "eneltop.com", font=font(48), fill="#ffffff")
draw.text((93, 225), "MI PUESTO EN EL RANKING", font=font(28), fill=teal)
draw.text((88, 260), f"#{rank}", font=fit_font(f"#{rank}", 570, 154, 94), fill=coral)
draw.text((95, 427), name, font=fit_font(name, 680, 55), fill=navy)
draw.text((96, 494), category, font=fit_font(category, 650, 31, 24), fill=muted)
draw.text((96, 537), "¿Quién se anima a superarme?" if rank == 1 else "Descubre mi proyecto",
          font=font(21), fill=teal)

center = (970, 367)
radius = 138
draw.ellipse((center[0]-radius-7, center[1]-radius-7,
              center[0]+radius+7, center[1]+radius+7), fill="#d9e8ed")
if avatar_path and os.path.isfile(avatar_path):
    try:
        with Image.open(avatar_path) as source:
            avatar = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"),
                                  (radius * 2, radius * 2), method=Image.Resampling.LANCZOS)
        mask = Image.new("L", avatar.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, avatar.width, avatar.height), fill=255)
        canvas.paste(avatar, (center[0]-radius, center[1]-radius), mask)
    except (OSError, ValueError):
        draw.ellipse((center[0]-radius, center[1]-radius,
                      center[0]+radius, center[1]+radius), fill="#b9d7df")
        initials = "".join(part[0] for part in name.split()[:2]).upper()
        draw.text(center, initials, font=font(94), fill=teal, anchor="mm")
else:
    draw.ellipse((center[0]-radius, center[1]-radius,
                  center[0]+radius, center[1]+radius), fill="#b9d7df")
    initials = "".join(part[0] for part in name.split()[:2]).upper()
    draw.text(center, initials, font=font(94), fill=teal, anchor="mm")

buffer = io.BytesIO()
canvas.save(buffer, format="PNG", optimize=True)
sys.stdout.buffer.write(buffer.getvalue())
