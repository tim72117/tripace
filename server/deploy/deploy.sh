#!/usr/bin/env bash
# Channel 後端 → Google Cloud Run 的「重複用」部署腳本。
# 改完程式碼跑這個即可;一次性設定(專案/帳單/API/secret)請先用 setup.sh。
#
# 用法(從任意位置):
#   PROJECT_ID=shuttle-xxxxx server/deploy/deploy.sh
# 可覆寫的環境變數:
#   PROJECT_ID  (必填) GCP 專案 ID
#   REGION      區域,預設 asia-east1
#   SERVICE     Cloud Run 服務名,預設 channel-server
#   DEV_MODE    Apple token 是否跳過驗簽,預設 true(正式上線改 false)
#   SEED        啟動是否寫示範資料,預設 false
#   LLM_KIND    rule | want,預設 rule
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?請設定 PROJECT_ID,例: PROJECT_ID=shuttle-xxxxx}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-channel-server}"
DEV_MODE="${DEV_MODE:-true}"
SEED="${SEED:-false}"
LLM_KIND="${LLM_KIND:-rule}"

# build context 必須是專案根目錄(Dockerfile 在根目錄,且要 COPY 到 want/)。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> 部署 $SERVICE 到 $REGION (專案 $PROJECT_ID)"
echo "    DEV_MODE=$DEV_MODE  SEED=$SEED  LLM_KIND=$LLM_KIND"

# secrets(DATABASE_URL / JWT_SECRET)已由 setup.sh 建好,這裡只引用 :latest。
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --port=8080 \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest" \
  --set-env-vars="DEV_MODE=${DEV_MODE},SEED=${SEED},LLM_KIND=${LLM_KIND}"

echo ""
echo "✅ 部署完成。服務 URL:"
gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" --region "$REGION" \
  --format='value(status.url)'
