#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
repo_dir=${script_dir:h}
source_dir="$repo_dir/resources/brand/vector"
public_brand_dir="$repo_dir/web/public/brand"
ios_assets_dir="$repo_dir/ios/App/App/Assets.xcassets"
chrome_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
brand_tmp_dir=$(mktemp -d)
trap 'rm -rf "$brand_tmp_dir"' EXIT

if [[ ! -x "$chrome_bin" ]]; then
  print -u2 "Google Chrome is required to export the brand PNGs."
  exit 1
fi

mkdir -p "$public_brand_dir"
cp "$source_dir/strong-cribbage-lockup-dark.svg" "$public_brand_dir/strong-cribbage-lockup-dark.svg"
cp "$source_dir/strong-cribbage-lockup-light.svg" "$public_brand_dir/strong-cribbage-lockup-light.svg"
cp "$source_dir/strong-cribbage-mark.svg" "$public_brand_dir/strong-cribbage-mark.svg"
cp "$source_dir/strong-cribbage-mark-micro.svg" "$public_brand_dir/strong-cribbage-mark-micro.svg"
cp "$source_dir/strong-cribbage-mark-monochrome.svg" "$public_brand_dir/strong-cribbage-mark-monochrome.svg"

render_svg() {
  local source_svg=$1
  local output_png=$2
  local dimensions=$3
  "$chrome_bin" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-crash-reporter \
    --default-background-color=00000000 \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --screenshot="$output_png" \
    --window-size="$dimensions" \
    "file://$source_svg" >/dev/null 2>&1
}

render_svg "$source_dir/strong-cribbage-app-icon.svg" "$brand_tmp_dir/app-icon-1024.png" "1024,1024"
render_svg "$source_dir/strong-cribbage-mark-micro.svg" "$brand_tmp_dir/micro-512.png" "512,512"
render_svg "$source_dir/strong-cribbage-social-preview.svg" "$repo_dir/web/public/social-preview-counted-monogram.png" "1200,630"
render_svg "$source_dir/strong-cribbage-splash.svg" "$brand_tmp_dir/splash-2732.png" "2732,2732"

sips -z 512 512 "$brand_tmp_dir/app-icon-1024.png" --out "$repo_dir/web/public/icon-512.png" >/dev/null
sips -z 192 192 "$brand_tmp_dir/app-icon-1024.png" --out "$repo_dir/web/public/icon-192.png" >/dev/null
sips -z 180 180 "$brand_tmp_dir/app-icon-1024.png" --out "$repo_dir/web/public/apple-touch-icon.png" >/dev/null
sips -z 32 32 "$brand_tmp_dir/micro-512.png" --out "$repo_dir/web/public/favicon-32x32.png" >/dev/null
sips -z 16 16 "$brand_tmp_dir/micro-512.png" --out "$repo_dir/web/public/favicon-16x16.png" >/dev/null

cp "$repo_dir/web/public/social-preview-counted-monogram.png" "$repo_dir/web/public/social-preview.png"

cp "$brand_tmp_dir/app-icon-1024.png" "$ios_assets_dir/AppIcon.appiconset/AppIcon-512@2x.png"
cp "$brand_tmp_dir/splash-2732.png" "$ios_assets_dir/Splash.imageset/splash-2732x2732.png"
cp "$brand_tmp_dir/splash-2732.png" "$ios_assets_dir/Splash.imageset/splash-2732x2732-1.png"
cp "$brand_tmp_dir/splash-2732.png" "$ios_assets_dir/Splash.imageset/splash-2732x2732-2.png"

print "Exported Counted Monogram assets."
