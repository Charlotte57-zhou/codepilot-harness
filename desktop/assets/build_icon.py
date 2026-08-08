from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parent
CANONICAL_MARK = ASSET_DIR.parent.parent / "public" / "assets" / "codepilot-mark.png"
OUTPUT_ICON = ASSET_DIR / "codepilot.ico"
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)
DESKTOP_SAFE_AREA_RATIO = 0.10


def build_desktop_icon() -> None:
    image = Image.open(CANONICAL_MARK).convert("RGBA")
    alpha = image.getchannel("A")
    visible_bounds = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
    if visible_bounds is None:
        raise ValueError("The canonical CodePilot mark has no visible pixels.")

    left, top, right, bottom = visible_bounds
    subject_side = max(right - left, bottom - top)
    padding = round(subject_side * DESKTOP_SAFE_AREA_RATIO)
    crop_side = subject_side + 2 * padding
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    crop_box = (
        round(center_x - crop_side / 2),
        round(center_y - crop_side / 2),
        round(center_x + crop_side / 2),
        round(center_y + crop_side / 2),
    )

    desktop_master = image.crop(crop_box)
    desktop_master.save(
        OUTPUT_ICON,
        format="ICO",
        sizes=[(size, size) for size in ICON_SIZES],
    )


if __name__ == "__main__":
    build_desktop_icon()
