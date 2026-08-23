"""Gera os ícones rasterizados da Agenda de Unha a partir do símbolo oficial."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCALE = 32
CANVAS = 64 * SCALE


def pt(value: float) -> int:
    return round(value * SCALE)


def cubic(p0, p1, p2, p3, steps=24):
    points = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        points.append(
            (
                pt(u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]),
                pt(u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]),
            )
        )
    return points


def make_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS))
    pixels = image.load()
    start = (153, 102, 204)
    end = (135, 68, 205)
    for y in range(CANVAS):
        for x in range(CANVAS):
            mix = (x + y) / (2 * (CANVAS - 1))
            pixels[x, y] = tuple(round(a + (b - a) * mix) for a, b in zip(start, end)) + (255,)

    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    line = pt(2.7)
    draw.rounded_rectangle((pt(10), pt(13), pt(49), pt(50)), radius=pt(8), outline=white, width=line)
    draw.line((pt(19), pt(8), pt(19), pt(19)), fill=white, width=pt(3.6))
    draw.line((pt(40), pt(8), pt(40), pt(19)), fill=white, width=pt(3.6))

    for x in (20, 29, 38):
        for y in (29, 38):
            draw.ellipse((pt(x - 2), pt(y - 2), pt(x + 2), pt(y + 2)), fill=white)

    nail = []
    nail += cubic((31, 51), (39, 39), (45.7, 33.2), (51, 33.7))
    nail += cubic((51, 33.7), (54.7, 34), (56.4, 36.7), (55.8, 40.4))[1:]
    nail += cubic((55.8, 40.4), (55, 45.3), (48.7, 48.4), (41.2, 48.2))[1:]
    nail += cubic((41.2, 48.2), (37.7, 48.1), (34.2, 49.5), (31, 51))[1:]
    draw.polygon(nail, fill=white)
    draw.line((pt(32), pt(58), pt(46), pt(44)), fill=white, width=pt(2.8))

    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    public = ROOT / "public"
    make_icon(192).save(public / "app-icon-192.png", optimize=True)
    icon_512 = make_icon(512)
    icon_512.save(public / "app-icon-512.png", optimize=True)
    icon_512.save(public / "app-icon-maskable-512.png", optimize=True)
    make_icon(180).save(public / "apple-touch-icon.png", optimize=True)
    icon_512.save(ROOT / "src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
