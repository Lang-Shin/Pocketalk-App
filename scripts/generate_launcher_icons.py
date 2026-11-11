"""Derive launcher resources from the approved logo; requires Pillow.

Run from the repository root: python scripts/generate_launcher_icons.py
The introduction asset is read-only. No prebuild or native regeneration.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / 'assets' / 'branding'
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
BACKGROUND = '#252427'
logo = Image.open(BRANDING / 'Pocketa.png').convert('RGBA')


def centered(size, fraction, background=(0, 0, 0, 0)):
    canvas = Image.new('RGBA', (size, size), background)
    artwork = logo.copy()
    artwork.thumbnail((round(size * fraction), round(size * fraction)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(artwork, ((size - artwork.width) // 2, (size - artwork.height) // 2))
    return canvas


# 48/108 width keeps this logo's complete rectangular bounds inside Android's
# 66dp safe circle, including circular masks and adaptive-icon motion.
foreground = centered(1024, 48 / 108)
monochrome = Image.new('RGBA', foreground.size, '#FFFFFF')
monochrome.putalpha(foreground.getchannel('A'))
legacy = centered(1024, 0.70, BACKGROUND)
foreground.save(BRANDING / 'pocketa-adaptive-foreground.png')
monochrome.save(BRANDING / 'pocketa-adaptive-monochrome.png')
legacy.save(BRANDING / 'pocketa-launcher.png')

for density, scale in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    folder = RES / f'mipmap-{density}'
    assert folder.is_dir(), folder
    adaptive_size, legacy_size = round(108 * scale), round(48 * scale)
    for name, image, size in [
        ('ic_launcher_foreground', foreground, adaptive_size),
        ('ic_launcher_monochrome', monochrome, adaptive_size),
        ('ic_launcher', legacy, legacy_size),
        ('ic_launcher_round', legacy, legacy_size),
    ]:
        image.resize((size, size), Image.Resampling.LANCZOS).save(folder / f'{name}.webp', lossless=True)
    Image.new('RGB', (adaptive_size, adaptive_size), BACKGROUND).save(folder / 'ic_launcher_background.webp', lossless=True)

print('Generated three Expo PNG assets and 25 native launcher WebP resources.')
