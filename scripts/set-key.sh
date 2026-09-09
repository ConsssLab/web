#!/usr/bin/env bash
# 互動式寫入本機 .env 的 API 金鑰。用法：bash scripts/set-key.sh [變數名]
# 預設寫 OPENAI_API_KEY；要寫 0G Compute 的就 bash scripts/set-key.sh OG_COMPUTE_API_KEY
set -euo pipefail
NAME="${1:-OPENAI_API_KEY}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
read -rsp "$NAME = " KEY && echo
[ -n "$KEY" ] || { echo "沒有輸入，取消。"; exit 1; }
# 已存在就就地取代，不存在就補在檔尾 —— 重複執行不會疊出兩行。
if grep -q "^${NAME}=" .env; then
  tmp=$(mktemp) && awk -v n="$NAME" -v v="$KEY" '$0 ~ "^"n"=" {print n"="v; next} {print}' .env > "$tmp" && mv "$tmp" .env
else
  printf '%s=%s\n' "$NAME" "$KEY" >> .env
fi
echo "✓ 已寫入 .env 的 $NAME（.env 在 .gitignore 裡，不會被 commit）"
