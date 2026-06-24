#!/usr/bin/env bash
# Channel 後端 → Google Cloud Run 的「一次性」環境設定。
# 只需在「新環境 / 新專案」跑一次:建專案、綁帳單、啟用 API、建 secret、授權。
# 平時改程式碼重新部署請改用同目錄的 deploy.sh。
#
# 用法(從專案根目錄或任意位置皆可):
#   PROJECT_ID=shuttle-xxxxx BILLING_ACCOUNT=01AA0C-56650D-E69542 \
#     server/deploy/setup.sh
#
# DATABASE_URL 取得方式(兩擇一):
#   - 自動:腳本會讀 server/.env 的 DATABASE_URL(預設行為)
#   - 手動:export DATABASE_URL='postgresql://...?sslmode=require' 後再跑
set -euo pipefail

# ---- 參數(可用環境變數覆寫) ----
PROJECT_ID="${PROJECT_ID:?請設定 PROJECT_ID,例: PROJECT_ID=shuttle-xxxxx}"
PROJECT_NAME="${PROJECT_NAME:-shuttle}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?請設定 BILLING_ACCOUNT,例: 01AA0C-56650D-E69542}"
REGION="${REGION:-asia-east1}"

# 定位專案根目錄(本腳本在 server/deploy/ 下,往上兩層)。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> 1/6 建立專案 $PROJECT_ID (名稱: $PROJECT_NAME)"
# 已存在則略過,不中斷。
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "    專案已存在,略過建立。"
else
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi
gcloud config set project "$PROJECT_ID"

echo "==> 2/6 綁定帳單帳戶 $BILLING_ACCOUNT"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

echo "==> 3/6 啟用必要 API(Cloud Run / Build / Artifact Registry / Secret Manager)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

echo "==> 4/6 取得 DATABASE_URL 並建立 secret"
# 優先用環境變數;否則從 server/.env 解析(去引號)。
if [ -z "${DATABASE_URL:-}" ]; then
  ENV_FILE="$ROOT/server/.env"
  if [ ! -f "$ENV_FILE" ]; then
    echo "    ✗ 未設 DATABASE_URL 環境變數,且找不到 $ENV_FILE" >&2
    exit 1
  fi
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE" \
    | head -1 \
    | sed -E 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//; s/^["'\'']//; s/["'\'']$//')"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "    ✗ DATABASE_URL 為空(server/.env 可能被註解掉)。" >&2
  exit 1
fi
# 用 printf 經 stdin 餵入,不落地明文檔。已存在則新增版本。
if gcloud secrets describe DATABASE_URL >/dev/null 2>&1; then
  printf '%s' "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=-
else
  printf '%s' "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=-
fi

echo "==> 5/6 產生並建立 JWT_SECRET secret"
# 已存在就不覆蓋(避免讓既有已簽發的 token 全部失效)。
if gcloud secrets describe JWT_SECRET >/dev/null 2>&1; then
  echo "    JWT_SECRET 已存在,保留現有值。"
else
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create JWT_SECRET --data-file=-
fi

echo "==> 6/6 授權 Cloud Run 服務帳號讀取 secret"
PNUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${PNUM}-compute@developer.gserviceaccount.com"
for S in DATABASE_URL JWT_SECRET; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  echo "    已授權 $SA 讀取 $S"
done

echo ""
echo "✅ 一次性設定完成。接著用 deploy.sh 部署:"
echo "   PROJECT_ID=$PROJECT_ID REGION=$REGION server/deploy/deploy.sh"
