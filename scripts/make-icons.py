#!/usr/bin/env python
"""
Generates Pinch's app icons.

The mark is a rupee held between two jaws — the app's whole job in one
picture: money, under control, being squeezed. Colours are the app's own
palette (neon green on near-black), so the launcher icon, the splash and
the first screen are all the same two colours.

Two things worth knowing if you change this:

- PIL strokes *inward* from the bounding box, so an arc of radius R drawn
  with width w actually spans R-w to R. Every draw here compensates, or
  the end caps land outside the stroke they are meant to finish.
- Nothing is antialiased by PIL's shape primitives, so everything is drawn
  at 4x and downsampled with LANCZOS. Drawn at 1024 directly, the arcs
  come out as visible staircases.

Run: python scripts/make-icons.py
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersample factor
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

BACKGROUND = (14, 14, 16, 255)  # palette.background #0E0E10
GREEN = (57, 255, 20, 255)  # palette.neonGreen #39FF14
WHITE = (255, 255, 255, 255)

# Segoe UI Black is used only to rasterise one glyph into these bitmaps; no
# font file is shipped with the app.
FONT_PATH = r"C:\Windows\Fonts\seguibl.ttf"

# The rupee's ink is bottom-left heavy, so its metric centre sits visibly
# high and left of where the eye expects it between the two jaws.
OPTICAL_NUDGE_Y = 0.012
OPTICAL_NUDGE_X = 0.004


def _arc(d, cx, cy, radius, start, end, width, fill):
    """An arc whose stroke is centred on `radius`, with rounded end caps."""
    r = radius + width / 2
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start, end=end, fill=fill, width=int(width))

    cap = width / 2
    for angle in (start, end):
        rad = math.radians(angle)
        px, py = cx + radius * math.cos(rad), cy + radius * math.sin(rad)
        d.ellipse([px - cap, py - cap, px + cap, py + cap], fill=fill)


def draw_mark(size: int, color=GREEN, scale: float = 1.0, jaws: bool = True) -> Image.Image:
    """The logo mark on a transparent canvas, `size` px square."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    u = (s / 1024.0) * scale  # one design unit == one pixel at 1024, pre-scale
    cx = s / 2 + OPTICAL_NUDGE_X * s
    cy = s / 2 + OPTICAL_NUDGE_Y * s

    glyph_height = 360 * u
    font = ImageFont.truetype(FONT_PATH, int(glyph_height * 1.62))
    glyph = "\u20b9"
    box = font.getbbox(glyph)
    d.text(
        (cx - (box[2] - box[0]) / 2 - box[0], cy - (box[3] - box[1]) / 2 - box[1]),
        glyph,
        font=font,
        fill=color,
    )

    if jaws:
        centre_y = s / 2
        _arc(d, s / 2, centre_y, 332 * u, -36, 36, 64 * u, color)
        _arc(d, s / 2, centre_y, 332 * u, 144, 216, 64 * u, color)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    # Launcher icon. Full-bleed square: every launcher applies its own mask,
    # so rounding the corners here would only round them twice.
    icon = Image.new("RGBA", (1024, 1024), BACKGROUND)
    icon.alpha_composite(draw_mark(1024, scale=0.78))
    icon.save(os.path.join(OUT, "icon.png"))

    # Android adaptive foreground. Launchers crop to a shape inscribed in the
    # middle ~66%, so the mark is scaled to survive the most aggressive mask.
    adaptive = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    adaptive.alpha_composite(draw_mark(1024, scale=0.60))
    adaptive.save(os.path.join(OUT, "adaptive-icon.png"))

    # Splash. Transparent, so the configured background colour shows through.
    splash = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    splash.alpha_composite(draw_mark(1024, scale=0.74))
    splash.save(os.path.join(OUT, "splash-icon.png"))

    # Android notification icon: the system discards colour and keeps only the
    # alpha channel, so anything but a white silhouette arrives as a grey blob.
    notification = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    notification.alpha_composite(draw_mark(96, color=WHITE, scale=0.88))
    notification.save(os.path.join(OUT, "notification-icon.png"))

    favicon = Image.new("RGBA", (64, 64), BACKGROUND)
    favicon.alpha_composite(draw_mark(64, scale=0.78))
    favicon.save(os.path.join(OUT, "favicon.png"))

    for name in (
        "icon.png",
        "adaptive-icon.png",
        "splash-icon.png",
        "notification-icon.png",
        "favicon.png",
    ):
        path = os.path.join(OUT, name)
        print(f"{name}: {os.path.getsize(path):,} bytes")


if __name__ == "__main__":
    main()
