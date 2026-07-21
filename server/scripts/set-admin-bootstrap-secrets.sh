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
# Secret Manager 的建立/新增版本權限(roles/secretmanager.admin 或等效)。

set -euo pipefail

PROJECT="shuttle-045094509"
EMAIL_SECRET="ADMIN_BOOTSTRAP_EMAIL"
PASSWORD_SECRET="ADMIN_BOOTSTRAP_PASSWORD"

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

echo "---"
echo "完成。deploy-admin.yml 下次部署時會透過"
echo "  --update-secrets=...,ADMIN_BOOTSTRAP_EMAIL=ADMIN_BOOTSTRAP_EMAIL:latest,ADMIN_BOOTSTRAP_PASSWORD=ADMIN_BOOTSTRAP_PASSWORD:latest"
echo "自動引用這兩個 secret 的最新版本。"
echo
echo "若這是第一次部署 adminserver,且該 email 尚未有對應的管理員帳號,"
echo "下次啟動時會自動建立;已存在則不會被重設密碼(冪等)。"
