#!/usr/bin/env bash
# 產生亂數密碼,同步更新 Cloud SQL 使用者密碼與 Cloud Run 用的 DATABASE_URL secret。
# 密碼只存在於這次執行的 shell 變數裡,不寫入任何檔案、不印在終端機、不進 log。
#
# 用法: bash scripts/rotate_db_password.sh
set -euo pipefail

SQL_PROJECT="onagent-prod"
SQL_INSTANCE="onagent-db"
CLOUDSQL_CONNECTION="onagent-prod:asia-east1:onagent-db"

SECRET_PROJECT="shuttle-045094509"
SECRET_NAME="DATABASE_URL"

DB_USER="shuttle_app"
DB_NAME="shuttle"

echo "產生新亂數密碼..."
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=+/' | head -c 32)

echo "更新 Cloud SQL 使用者 ${DB_USER}@${SQL_INSTANCE}(project=${SQL_PROJECT})的密碼..."
gcloud sql users set-password "${DB_USER}" \
  --instance="${SQL_INSTANCE}" \
  --project="${SQL_PROJECT}" \
  --password="${DB_PASSWORD}"

echo "密碼已更新。組裝連線字串並寫入 Secret Manager(project=${SECRET_PROJECT}, secret=${SECRET_NAME})..."

ENCODED_PASSWORD=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${DB_PASSWORD}")
DSN="postgres://${DB_USER}:${ENCODED_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CLOUDSQL_CONNECTION}&sslmode=disable"

printf '%s' "${DSN}" | gcloud secrets versions add "${SECRET_NAME}" --project="${SECRET_PROJECT}" --data-file=-

unset DB_PASSWORD ENCODED_PASSWORD DSN

echo ""
echo "完成:Cloud SQL 密碼與 Secret Manager 已同步。"
echo "接著執行以下指令重新部署 channel-server,讓它讀取最新 secret 版本:"
echo ""
echo "  gcloud run deploy channel-server --project=${SECRET_PROJECT} --region=asia-east1 \\"
echo "    --image=asia-east1-docker.pkg.dev/${SECRET_PROJECT}/cloud-run-source-deploy/channel-server@sha256:ec01884dc0fe0d0e3e556483735d6205955c901149f61107274b197eb6d101e1 \\"
echo "    --quiet"
