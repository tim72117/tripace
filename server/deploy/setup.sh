#!/usr/bin/env bash
# Tripace 後端 → Google Cloud Run 的「一次性」環境設定。
# 只需在「新環境 / 新專案」跑一次:建專案、綁帳單、啟用 API、建 secret、授權、
# 設定 GitHub Actions 的 Workload Identity Federation(讓 .github/workflows/
# deploy-cloudrun.yml 能免金鑰認證存取這個專案)。
#
# 跑完這支腳本後,還有兩件事無法用 gcloud 自動完成,腳本結尾會印出來:
#   1. 把印出的 WIF_PROVIDER / WIF_SERVICE_ACCOUNT 貼進 GitHub repo 的
#      Settings → Secrets and variables → Actions(或用 gh secret set)。
#   2. GH_PAT(私有依賴用的 GitHub PAT)本身不是這個腳本管的範圍,需另外簽發。
# 這兩步做完,deploy-cloudrun.yml 才能真正跑通(google-github-actions/auth
# 那一步之前完全失敗,不會進到 build/push/deploy)。
#
# 用法(從專案根目錄或任意位置皆可):
#   PROJECT_ID=tripace-xxxxx BILLING_ACCOUNT=01AA0C-56650D-E69542 \
#   GITHUB_REPO=owner/repo \
#     server/deploy/setup.sh
#
# DATABASE_URL / GOOGLE_API_KEY 取得方式(兩擇一):
#   - 自動:腳本會讀 server/.env 的對應變數(預設行為)
#   - 手動:export DATABASE_URL='postgresql://...?sslmode=require' 等後再跑
#
# ⚠️  警告:CLOUDSQL_INSTANCE 目前在 .github/workflows/deploy-cloudrun.yml 裡
#     是寫死的 "onagent-prod:asia-east1:onagent-db",指向 onagent-prod 這個
#     專案的 Cloud SQL 實例,**不是**本腳本操作的 PROJECT_ID。這支 setup.sh
#     不會、也無法自動處理這件事。如果你要部署到一個真正獨立的全新專案,
#     跑完本腳本後還必須自行:
#       (a) 在新專案(PROJECT_ID)裡建立對應的 Cloud SQL 實例;
#       (b) 手動修改 deploy-cloudrun.yml 裡的 CLOUDSQL_INSTANCE 值,
#           改成指向新專案的實例(格式:PROJECT_ID:REGION:INSTANCE_NAME)。
#     這兩步不做,deploy-cloudrun.yml 的 --add-cloudsql-instances 部署參數
#     會指向新專案裡不存在的資源,導致部署失敗或行為不符預期。
set -euo pipefail

# ---- 參數(可用環境變數覆寫) ----
PROJECT_ID="${PROJECT_ID:?請設定 PROJECT_ID,例: PROJECT_ID=tripace-xxxxx}"
PROJECT_NAME="${PROJECT_NAME:-tripace}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?請設定 BILLING_ACCOUNT,例: 01AA0C-56650D-E69542}"
REGION="${REGION:-asia-east1}"
# owner/repo 格式,例如 tim72117/tripace——WIF provider 的 attributeCondition
# 會鎖死只信任這個 repo 發出的 OIDC token。**repo 若之後改名,這裡跟下面
# service account 的 IAM binding 都要同步更新,否則 GitHub Actions 會在
# auth 那步直接失敗**(這正是本專案實際踩過的問題,見 git log 訊息)。
GITHUB_REPO="${GITHUB_REPO:?請設定 GITHUB_REPO,格式 owner/repo,例: GITHUB_REPO=tim72117/tripace}"

# 定位專案根目錄(本腳本在 server/deploy/ 下,往上兩層)。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> 1/10 建立專案 $PROJECT_ID (名稱: $PROJECT_NAME)"
# 已存在則略過,不中斷。
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "    專案已存在,略過建立。"
else
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi
gcloud config set project "$PROJECT_ID"

echo "==> 2/10 綁定帳單帳戶 $BILLING_ACCOUNT"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

echo "==> 3/10 啟用必要 API(Cloud Run / Build / Artifact Registry / Secret Manager / IAM)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com

echo "==> 4/10 建立 Artifact Registry repository(deploy-cloudrun.yml 的 IMAGE push 目標)"
# deploy-cloudrun.yml 的 IMAGE 變數指向
# asia-east1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/tripace-server,
# 代表這個名為 cloud-run-source-deploy、格式 DOCKER、位於 $REGION 的 repo
# 必須預先存在,否則首次跑 workflow 會在 docker push 那步失敗。已存在則略過。
AR_REPO="cloud-run-source-deploy"
if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "    Artifact Registry repo $AR_REPO 已存在,略過建立。"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Cloud Run 部署用的 container image repo(由 setup.sh 建立)"
fi

echo "==> 5/10 取得 DATABASE_URL 並建立 secret"
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

echo "==> 6/10 產生並建立 JWT_SECRET secret"
# 已存在就不覆蓋(避免讓既有已簽發的 token 全部失效)。
if gcloud secrets describe JWT_SECRET >/dev/null 2>&1; then
  echo "    JWT_SECRET 已存在,保留現有值。"
else
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create JWT_SECRET --data-file=-
fi

echo "==> 7/10 取得 GOOGLE_API_KEY 並建立 secret(deploy-cloudrun.yml 的 AI_PROVIDER=googleapis 需要)"
if [ -z "${GOOGLE_API_KEY:-}" ]; then
  ENV_FILE="$ROOT/server/.env"
  if [ -f "$ENV_FILE" ]; then
    GOOGLE_API_KEY="$(grep -E '^[[:space:]]*GOOGLE_API_KEY[[:space:]]*=' "$ENV_FILE" \
      | head -1 \
      | sed -E 's/^[[:space:]]*GOOGLE_API_KEY[[:space:]]*=[[:space:]]*//; s/^["'\'']//; s/["'\'']$//')"
  fi
fi
if [ -z "${GOOGLE_API_KEY:-}" ]; then
  echo "    ✗ 未設 GOOGLE_API_KEY 環境變數,且 server/.env 找不到對應值。" >&2
  echo "      請至 https://aistudio.google.com/apikey 取得後,export GOOGLE_API_KEY=... 再重跑。" >&2
  exit 1
fi
if gcloud secrets describe GOOGLE_API_KEY >/dev/null 2>&1; then
  printf '%s' "$GOOGLE_API_KEY" | gcloud secrets versions add GOOGLE_API_KEY --data-file=-
else
  printf '%s' "$GOOGLE_API_KEY" | gcloud secrets create GOOGLE_API_KEY --data-file=-
fi

echo "==> 8/10 授權 Cloud Run 服務帳號讀取 secret"
PNUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PNUM}-compute@developer.gserviceaccount.com"
for S in DATABASE_URL JWT_SECRET GOOGLE_API_KEY; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  echo "    已授權 $RUNTIME_SA 讀取 $S"
done

echo "==> 9/10 建立 GitHub Actions 部署用的 service account"
DEPLOY_SA_ID="github-actions-deploy"
DEPLOY_SA="${DEPLOY_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1; then
  echo "    $DEPLOY_SA 已存在,略過建立。"
else
  gcloud iam service-accounts create "$DEPLOY_SA_ID" --display-name="GitHub Actions Deploy"
fi
# 部署 Cloud Run + 推 Artifact Registry image + 讀 secret 所需的專案層級角色。
for ROLE in roles/run.admin roles/artifactregistry.admin roles/storage.admin \
            roles/cloudbuild.builds.builder roles/iam.serviceAccountUser \
            roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$DEPLOY_SA" \
    --role="$ROLE" >/dev/null
done
echo "    已授權 $DEPLOY_SA 部署所需角色"

echo "==> 10/10 設定 Workload Identity Federation(讓 GitHub Actions 免金鑰登入)"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
if gcloud iam workload-identity-pools describe "$POOL_ID" --location=global >/dev/null 2>&1; then
  echo "    workload identity pool $POOL_ID 已存在,略過建立。"
else
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global \
    --display-name="GitHub Actions Pool"
fi
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" --location=global >/dev/null 2>&1; then
  echo "    provider $PROVIDER_ID 已存在,更新 attributeCondition 為目前的 $GITHUB_REPO"
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" \
    --location=global \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" \
    --location=global \
    --display-name="GitHub Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
fi
# 只允許「這個 repo 發出的 token」冒充這個部署 service account——這條 binding
# 跟上面 provider 的 attributeCondition 是兩個獨立的檢查點,repo 改名時
# **兩處都要更新**,只改一處仍然會在 auth 那步失敗。
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PNUM}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  >/dev/null

WIF_PROVIDER="projects/${PNUM}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo ""
echo "✅ GCP 端一次性設定完成。"
echo ""
echo "還差最後兩步,無法用 gcloud 自動完成:"
echo ""
echo "1. 把下面兩個值設進 GitHub repo secrets(Settings → Secrets and variables"
echo "   → Actions,或用 gh secret set 指令):"
echo ""
echo "   WIF_PROVIDER=${WIF_PROVIDER}"
echo "   WIF_SERVICE_ACCOUNT=${DEPLOY_SA}"
echo ""
echo "   用 gh CLI 一次設完:"
echo "   gh secret set WIF_PROVIDER --repo ${GITHUB_REPO} --body '${WIF_PROVIDER}'"
echo "   gh secret set WIF_SERVICE_ACCOUNT --repo ${GITHUB_REPO} --body '${DEPLOY_SA}'"
echo ""
echo "2. 簽發一個有私有依賴讀取權限的 GitHub PAT,設成 GH_PAT secret:"
echo "   gh secret set GH_PAT --repo ${GITHUB_REPO}"
echo ""
echo "完成以上兩步後,push 到 main(或手動觸發 workflow_dispatch)即可部署,"
echo "不需要額外的手動部署腳本——.github/workflows/deploy-cloudrun.yml"
echo "已包含 --allow-unauthenticated,首次建立新服務也會自動開放公開存取。"
