from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(parents=True, exist_ok=True)

for size in (16, 32, 48, 128):
    scale = 4
    canvas = size * scale
    image = Image.new("RGB", (canvas, canvas), "#01559D")
    draw = ImageDraw.Draw(image)
    white = "#FFFFFF"
    red = "#ED1C24"

    shaft_width = max(2 * scale, canvas // 8)
    center = canvas // 2
    top = canvas // 5
    arrow_y = canvas * 3 // 5
    draw.rectangle((center - shaft_width // 2, top, center + shaft_width // 2, arrow_y), fill=white)
    draw.polygon([
        (canvas // 4, canvas // 2),
        (canvas * 3 // 4, canvas // 2),
        (center, canvas * 3 // 4),
    ], fill=white)
    tray_height = max(2 * scale, canvas // 18)
    draw.rectangle((canvas // 5, canvas * 4 // 5, canvas * 4 // 5, canvas * 4 // 5 + tray_height), fill=white)
    draw.rectangle((0, canvas - max(scale, canvas // 32), canvas, canvas), fill=red)
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(OUT / f"icon-{size}.png", optimize=True)
