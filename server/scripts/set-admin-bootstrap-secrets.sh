#!/usr/bin/env bash
# 建立/更新 GCP Secret Manager 裡的 ADMIN_BOOTSTRAP_EMAIL、
# ADMIN_BOOTSTRAP_PASSWORD 兩個密鑰,供 deploy-admin.yml 部署
# adminserver(server/cmd/adminserver)時透過 --update-secrets 引用。
# adminserver 啟動時用這兩個環境變數 Bootstrap 第一個管理員帳號(見
# server/cmd/adminserver/main.go 呼叫 adminAuth.Bootstrap 的地方;
# 已存在的 email 不會被重設密碼,是冪等操作)。
#
# 密碼刻意不當成指令參數傳入(避免留在 shell history / `ps` 輸出),
# 執行時會用隱藏輸入的方式互動詢問。
#
# 用法:
#   ./scripts/set-admin-bootstrap-secrets.sh admin@example.com
#
# 需求:已安裝並登入 gcloud(gcloud auth login),且對目標專案有
# Secret Manager 的建立/新增版本權限(roles/secretmanager.admin 或等效)、
# 以及授予 IAM 綁定的權限(roles/secretmanager.admin 或
# roles/resourcemanager.projectIamAdmin 等能執行
# secrets add-iam-policy-binding 的角色)。
#
# 這支腳本除了寫入 secret 值本身,還會授權 Cloud Run 執行服務帳號讀取
# 這兩個新 secret(見下方 grant_accessor)——GCP Secret Manager 的存取權限
# 是逐個 secret 授權的,不會因為服務帳號已經能讀 DATABASE_URL 等既有 secret
# 就自動能讀新建的 secret。若漏了這一步,adminserver 部署時會卡在
# SecretsAccessCheckFailed(Permission denied on secret ... for Revision
# service account ...),Cloud Run revision 永遠無法就緒。

set -euo pipefail

PROJECT="shuttle-045094509"
EMAIL_SECRET="ADMIN_BOOTSTRAP_EMAIL"
PASSWORD_SECRET="ADMIN_BOOTSTRAP_PASSWORD"
# Cloud Run 服務(tripace-server、tripace-adminserver)目前都用這個專案預設
# 的運算服務帳號執行(deploy-cloudrun.yml/deploy-admin.yml 都沒有另外指定
# --service-account),故 secret 的 accessor 授權也是授給它。若之後改成
# 專用的 service account,這裡要跟著改。
RUNTIME_SA="340121279179-compute@developer.gserviceaccount.com"

if [ $# -ne 1 ]; then
  echo "用法: $0 <管理員 email>" >&2
  echo "範例: $0 admin@example.com" >&2
  exit 1
fi

EMAIL="$1"

echo "專案:  $PROJECT"
echo "Email: $EMAIL"
echo "---"

read -rsp "請輸入管理員密碼(至少 6 字元,輸入時不會顯示): " PASSWORD
echo
if [ -z "$PASSWORD" ] || [ "${#PASSWORD}" -lt 6 ]; then
  echo "✗ 密碼不可為空且至少需要 6 字元" >&2
  exit 1
fi
read -rsp "請再輸入一次密碼以確認: " PASSWORD_CONFIRM
echo
if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "✗ 兩次輸入的密碼不一致" >&2
  exit 1
fi
echo "---"

# upsert_secret <secret 名稱> <值>:secret 不存在就建立,已存在就新增一個版本
# (Secret Manager 的值本身就是版本化的,--data-file=- 從 stdin 讀值,避免值
# 出現在指令參數或 shell history 裡)。--replication-policy=automatic 是
# 多區域自動複寫,跟專案內其他既有 secret(DATABASE_URL/JWT_SECRET 等)
# 的慣例一致(未特別指定 region 限制)。
upsert_secret() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "$value" | gcloud secrets versions add "$name" \
      --project="$PROJECT" \
      --data-file=- \
      --quiet
    echo "✓ 已為既有 secret「$name」新增一個版本"
  else
    echo "$value" | gcloud secrets create "$name" \
      --project="$PROJECT" \
      --replication-policy=automatic \
      --data-file=- \
      --quiet
    echo "✓ 已建立新 secret「$name」"
  fi
}

echo "設定 $EMAIL_SECRET…"
upsert_secret "$EMAIL_SECRET" "$EMAIL"

echo "設定 $PASSWORD_SECRET…"
upsert_secret "$PASSWORD_SECRET" "$PASSWORD"

# grant_accessor <secret 名稱>:授予 RUNTIME_SA 讀取這個 secret 的權限
# (roles/secretmanager.secretAccessor,綁在 secret 層級而非專案層級,權限
# 範圍最小化)。add-iam-policy-binding 本身是冪等操作,重複執行不會出錯或
# 疊加重複綁定,故不需要先檢查是否已授權過。
grant_accessor() {
  local name="$1"
  gcloud secrets add-iam-policy-binding "$name" \
    --project="$PROJECT" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
  echo "✓ 已授權 $RUNTIME_SA 讀取「$name」"
}

echo "授權 Cloud Run 執行服務帳號讀取密鑰…"
grant_accessor "$EMAIL_SECRET"
grant_accessor "$PASSWORD_SECRET"

echo "---"
echo "完成。deploy-admin.yml 下次部署時會透過"
echo "  --update-secrets=...,ADMIN_BOOTSTRAP_EMAIL=ADMIN_BOOTSTRAP_EMAIL:latest,ADMIN_BOOTSTRAP_PASSWORD=ADMIN_BOOTSTRAP_PASSWORD:latest"
echo "自動引用這兩個 secret 的最新版本,且執行服務帳號已有權限讀取。"
echo
echo "若這是第一次部署 adminserver,且該 email 尚未有對應的管理員帳號,"
echo "下次啟動時會自動建立;已存在則不會被重設密碼(冪等)。"
