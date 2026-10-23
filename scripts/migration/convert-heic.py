#!/usr/bin/env python3
"""Convert HEIC downloads to JPEG for web display (migration-time only)."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()


def convert(src: Path, dest: Path, quality: int = 88) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(src).convert("RGB")
    image.save(dest, "JPEG", quality=quality, optimize=True)
    print(f"{src} → {dest} {image.size}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dest")
    parser.add_argument("--quality", type=int, default=88)
    args = parser.parse_args()
    convert(Path(args.src), Path(args.dest), args.quality)


if __name__ == "__main__":
    main()
