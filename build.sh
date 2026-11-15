#!/bin/sh
# erp.html(아티팩트용 본문)을 감싸서 독립 실행용 index.html을 만든다.
# 아티팩트는 doctype/head를 자동으로 붙여주지만 버셀 같은 일반 호스팅은 그렇지 않다.
SRC="$1"
OUT="$(dirname "$0")/index.html"
if [ -z "$SRC" ]; then SRC="$(dirname "$0")/erp.html"; fi

{
  echo '<!doctype html>'
  echo '<html lang="ko">'
  echo '<head>'
  echo '<meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  echo '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
  echo '</head>'
  echo '<body>'
  cat "$SRC"
  echo '</body>'
  echo '</html>'
} > "$OUT"

echo "만들었습니다: $OUT"
