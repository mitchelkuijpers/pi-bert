#!/usr/bin/env bash
set -euo pipefail

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 (the 'magick' command) is required." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_image="${1:-$root/bert-sprites.png}"
out_dir="$root/assets/frames"

if [[ ! -f "$source_image" ]]; then
  echo "Sprite sheet not found: $source_image" >&2
  exit 1
fi

mkdir -p "$out_dir"

# Interior origins of the 4x5 sprite grid. The crop deliberately excludes the
# title, row/column labels, and black grid lines from the source sheet.
xs=(230 746 1262 1779 2296)
ys=(210 543 876 1208)
poses=(neutral annoyed gesturing tired)
mouths=(closed wide-open rounded tucked-lip smile)

for row in "${!poses[@]}"; do
  for column in "${!mouths[@]}"; do
    output="$out_dir/${poses[$row]}-${mouths[$column]}.png"
    # 256-color palette (with default error-diffusion dithering) cuts each
    # frame from ~87 KB to ~19 KB with no visible difference at the 20x7 cell
    # display size, which keeps Kitty image re-uploads cheap in terminals.
    magick "$source_image" \
      -crop "512x326+${xs[$column]}+${ys[$row]}" \
      +repage \
      -resize "320x204" \
      -strip \
      -define png:compression-level=9 \
      -colors 256 \
      "png8:$output"
  done
done

echo "Generated 20 Bert frames in $out_dir"
