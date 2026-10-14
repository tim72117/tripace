#!/bin/bash
# img2webp.sh — 批次把資料夾裡的圖片轉成適合網頁用的 WebP。
#
# 用法：
#   ./img2webp.sh <輸入資料夾> [輸出資料夾]
#
# 預設行為：
#   - 讀取輸入資料夾裡所有 .jpg/.jpeg/.png（不分大小寫），依 EXIF 方向
#     自動校正（sips 內建處理，避免手機直出圖旋轉跑掉）
#   - 等比例縮小到最長邊不超過 1600px（已經是原尺寸以下的圖片不放大）
#   - 用 cwebp 轉成 WebP，畫質 80（一般網頁照片/卡片的平衡點）
#   - 輸出檔名與原檔同名，副檔名改成 .webp
#   - 非圖片檔案（例如 .MOV 影片）直接跳過，不處理
#
# 需要：macOS 內建 sips（縮圖）+ Homebrew 裝的 cwebp（WebP 編碼）。
#   brew install webp   # 如果還沒裝 cwebp

set -euo pipefail

MAX_DIM=1600
QUALITY=80

usage() {
  echo "用法：$0 <輸入資料夾> [輸出資料夾]" >&2
  echo "  預設輸出資料夾：<輸入資料夾>/webp-output" >&2
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

IN_DIR="$1"
OUT_DIR="${2:-$IN_DIR/webp-output}"

if [ ! -d "$IN_DIR" ]; then
  echo "錯誤：輸入資料夾不存在：$IN_DIR" >&2
  exit 1
fi

if ! command -v cwebp >/dev/null 2>&1; then
  echo "錯誤：找不到 cwebp，請先執行：brew install webp" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# TMP_DIR 放 sips 縮圖後、轉 webp 前的中繼檔——cwebp 本身不支援 -resize
# 這種依最長邊等比縮放的選項（只有 -resize <w> <h> 這種寫死寬高的版本，
# 算等比例還要自己先讀原始尺寸再算，不如交給 sips 一次做完縮放+方向
# 校正），故用 sips 縮放產生中繼 JPEG，再交給 cwebp 編碼，用完即丟。
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

count=0
skipped=0
total_in_bytes=0
total_out_bytes=0

shopt -s nullglob nocaseglob
for f in "$IN_DIR"/*.jpg "$IN_DIR"/*.jpeg "$IN_DIR"/*.png; do
  base="$(basename "$f")"
  name="${base%.*}"
  tmp_resized="$TMP_DIR/$name.jpg"
  out_file="$OUT_DIR/$name.webp"

  # sips -Z <邊長>：等比例縮小到最長邊不超過這個值，已經比目標小的圖片
  # 不會被放大（sips 內建行為，不需要自己判斷原始尺寸）。
  if ! sips -Z "$MAX_DIM" "$f" --out "$tmp_resized" >/dev/null 2>&1; then
    echo "跳過（sips 縮圖失敗）：$base" >&2
    skipped=$((skipped + 1))
    continue
  fi

  if ! cwebp -q "$QUALITY" -quiet "$tmp_resized" -o "$out_file"; then
    echo "跳過（cwebp 轉檔失敗）：$base" >&2
    skipped=$((skipped + 1))
    continue
  fi

  in_bytes=$(stat -f%z "$f")
  out_bytes=$(stat -f%z "$out_file")
  total_in_bytes=$((total_in_bytes + in_bytes))
  total_out_bytes=$((total_out_bytes + out_bytes))
  count=$((count + 1))

  printf '%-28s %6.1fMB -> %5.1fMB\n' \
    "$base" \
    "$(echo "$in_bytes / 1048576" | bc -l)" \
    "$(echo "$out_bytes / 1048576" | bc -l)"
done
shopt -u nullglob nocaseglob

echo "---"
if [ "$count" -eq 0 ]; then
  echo "沒有任何圖片被轉檔（找不到 .jpg/.jpeg/.png，或全部失敗）。"
  exit 0
fi

saved_pct=$(echo "scale=1; (1 - $total_out_bytes / $total_in_bytes) * 100" | bc -l)
printf '完成：%d 張成功，%d 張跳過。總大小 %.1fMB -> %.1fMB（省下 %s%%）\n' \
  "$count" "$skipped" \
  "$(echo "$total_in_bytes / 1048576" | bc -l)" \
  "$(echo "$total_out_bytes / 1048576" | bc -l)" \
  "$saved_pct"
echo "輸出位置：$OUT_DIR"
