"""The app icon (a page of music with its corner turning) at any size, and the launch screen for the iPad app.
   python3 tools/make_icons.py
Writes icons/icon-1024.png (App Store, no transparency), native/ios/App/App/Assets.xcassets/AppIcon.appiconset and the
splash images. Drawn at 4x and scaled down for smooth edges. Coordinates are in the 512-pixel design."""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG, PAGE, INK, GOLD = (246, 247, 249), (255, 255, 255), (30, 33, 37), (216, 180, 95)

def glyph(d, k, ox=0, oy=0, bg=BG):
    s = lambda v: v * k
    pt = lambda x, y: (ox + s(x), oy + s(y))
    # the page: a dark border, white inside
    d.rounded_rectangle([pt(103, 87), pt(409, 425)], radius=s(13), fill=INK)
    d.rounded_rectangle([pt(115, 99), pt(397, 413)], radius=s(3), fill=PAGE)
    # two staves of five lines
    for y in (161, 179, 197, 215, 233, 283, 301, 319, 337, 355):
        d.rectangle([pt(133, y - 1.75), pt(379, y + 1.75)], fill=INK)
    # the corner turning: the page cut along x + y = 731, the turned flap in gold
    d.polygon([pt(420, 311), pt(440, 311), pt(440, 445), pt(286, 445)], fill=bg)
    d.polygon([pt(307, 323), pt(408, 323), pt(307, 424)], fill=GOLD)
    d.line([pt(408, 323), pt(307, 424)], fill=INK, width=max(1, int(s(1.5))))

def icon(size, bg=BG):
    k = 4 * size / 512
    im = Image.new("RGB", (4 * size, 4 * size), bg)
    glyph(ImageDraw.Draw(im), k, bg=bg)
    return im.resize((size, size), Image.LANCZOS)

def splash(size=2732, bg=(233, 230, 224), mark=520):
    big = 4
    im = Image.new("RGB", (size, size), bg)
    g = Image.new("RGB", (mark * big, mark * big), bg)
    glyph(ImageDraw.Draw(g), mark * big / 512, bg=bg)
    g = g.resize((mark, mark), Image.LANCZOS)
    im.paste(g, ((size - mark) // 2, (size - mark) // 2))
    return im

if __name__ == "__main__":
    icon(1024).save(os.path.join(ROOT, "icons", "icon-1024.png"))
    appicon = os.path.join(ROOT, "native", "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    if os.path.isdir(appicon):
        for f in os.listdir(appicon):
            if f.endswith(".png"): os.remove(os.path.join(appicon, f))
        icon(1024).save(os.path.join(appicon, "AppIcon-1024.png"))
        json.dump({"images": [{"filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
                   "info": {"author": "xcode", "version": 1}}, open(os.path.join(appicon, "Contents.json"), "w"), indent=2)
        sp = os.path.join(appicon, "..", "Splash.imageset")
        im = splash()
        for f in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"): im.save(os.path.join(sp, f))
    print("ok")
