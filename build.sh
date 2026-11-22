#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -f optpaper.zip
zip -r optpaper.zip manifest.json *.html *.js style.css icons vendor -x "test*"
echo "Built optpaper.zip"
unzip -l optpaper.zip | tail -1
