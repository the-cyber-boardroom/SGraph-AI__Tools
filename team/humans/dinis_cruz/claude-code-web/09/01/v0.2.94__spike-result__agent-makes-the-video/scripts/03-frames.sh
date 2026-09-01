#!/bin/bash
# 03-frames.sh — stills from the rendered videos, so the result can be judged without watching.
# Usage: FFMPEG=/path/to/ffmpeg bash 03-frames.sh
set -e
FF=${FFMPEG:-ffmpeg}
cd "$(dirname "$0")/.."
mkdir -p frames
for f in landscape shorts; do
  [ -f "$f.webm" ] || continue
  dur=$($FF -i "$f.webm" 2>&1 | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p')
  secs=$(echo "$dur" | awk -F: '{ print ($1*3600)+($2*60)+$3 }')
  step=$([ "$f" = landscape ] && echo 8 || echo 6)
  t=1
  while [ "$(echo "$t < $secs" | bc)" = 1 ]; do
    $FF -hide_banner -v error -y -ss "$t" -i "$f.webm" -frames:v 1 "frames/$f-$(printf %03d "$t")s.png"
    t=$((t + step))
  done
  echo "$f: $dur -> $(ls frames/$f-*.png | wc -l) frames"
done
