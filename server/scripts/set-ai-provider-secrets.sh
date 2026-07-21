#!/usr/bin/env bash
# =============================================================================
# tripace — 互動式設定 AI_PROVIDER 與 Google Places 相關的 Secret Manager secret
#
# 這支腳本會問你要用哪個 provider、要用哪個 model、要不要換金鑰，
# 直接在這支腳本裡完成 Secret Manager 的寫入 —— 不會印出金鑰本身、
# 不會把金鑰寫進任何檔案，金鑰只在這次執行的記憶體中短暫存在。
#
# 支援部分更新：model 那一步直接按 Enter 就完全略過 —— 不印出任何 AI_MODEL
# 建議值，deploy-cloudrun.yml 裡現有的設定維持不變；金鑰那一步會先問要不要
# 更新，選否就完全跳過輸入，不會動到 Secret Manager 裡現有的版本。
#
# GOOGLE_PLACES_API_KEY 是獨立於 AI_PROVIDER 之外的另一組金鑰(供
# internal/wanttools 的 geocode/recommend_nearby 這兩個工具查詢 Google Places
# API 用,與 LLM provider 選的是 claude 還是 googleapis 無關,即使 AI_PROVIDER
# 選 claude 也可能需要它)——這支腳本目前是 Cloud Run(shuttle-045094509 專案)
# 唯一設定它的地方,故一併整合進來,不另外開一支腳本。
#
#     用法：bash server/scripts/set-ai-provider-secrets.sh
# =============================================================================

set -euo pipefail

PROJECT_ID="shuttle-045094509"

echo "=============================================="
echo " tripace AI_PROVIDER / Google Places 設定"
echo " PROJECT_ID = ${PROJECT_ID}"
echo "=============================================="
echo

# -----------------------------------------------------------------------------
# 1. 選 provider
# -----------------------------------------------------------------------------
echo "要用哪個 provider？"
echo "  1) claude（Anthropic Claude，需要 ANTHROPIC_API_KEY）"
echo "  2) googleapis（Google Gemini，需要 GOOGLE_API_KEY）"
read -r -p "輸入 1 或 2: " PROVIDER_CHOICE

# 這兩個字串必須跟 want/orchestrator/init.go 的 InitializeWithConfig switch
# case 完全一致（"claude" / "googleapis"，不是更直覺的 "anthropic" / "google"）
# —— 打錯字不會在這支腳本被發現，是部署後的 Cloud Run 容器啟動時才會炸：
# "不支援的提供者: xxx"，所以這裡故意寫死成 want 認得的值，不留使用者自訂空間。
case "${PROVIDER_CHOICE}" in
  1)
    AI_PROVIDER="claude"
    SECRET_NAME="ANTHROPIC_API_KEY"
    DEFAULT_MODEL="claude-sonnet-5"
    ;;
  2)
    AI_PROVIDER="googleapis"
    SECRET_NAME="GOOGLE_API_KEY"
    DEFAULT_MODEL="gemini-2.5-pro"
    ;;
  *)
    echo "沒有這個選項，離開。"
    exit 1
    ;;
esac

# -----------------------------------------------------------------------------
# 2. 輸入 model 名稱 —— 留空真正代表「不變」：這支腳本不知道
#    deploy-cloudrun.yml 裡現在實際設定的是哪個 model，所以留空時不套用任何
#    值（包括下面的 DEFAULT_MODEL），只在你真的想指定新 model 時才印出來，
#    讓摘要不會意外覆蓋你已經在用、腳本並不知情的設定。
# -----------------------------------------------------------------------------
read -r -p "要用哪個 model？(直接按 Enter 表示不變，或輸入新值，例如 ${DEFAULT_MODEL}): " AI_MODEL
if [[ -z "${AI_MODEL}" ]]; then
  echo "略過 model 設定 —— deploy-cloudrun.yml 裡現有的 AI_MODEL 沿用不變。"
fi

# -----------------------------------------------------------------------------
# upsert_secret <secret 名稱>:互動詢問是否更新、要更新就建立容器(已存在則
# 略過)+ 隱藏輸入寫入新版本。抽成函式,因為 LLM provider 金鑰與下面的
# GOOGLE_PLACES_API_KEY 都要走同一套「先問要不要換、換就整段互動輸入」流程。
# -----------------------------------------------------------------------------
upsert_secret() {
  local name="$1"
  local prompt_label="$2"

  read -r -p "要更新 ${name} 的金鑰值嗎？(y/N，只是換 provider/model 不換金鑰請輸入 N): " update_choice
  if [[ ! "${update_choice}" =~ ^[Yy]$ ]]; then
    echo "略過 ${name} 更新 —— 沿用 Secret Manager 裡現有的版本。"
    return 0
  fi

  gcloud secrets create "${name}" \
    --replication-policy="automatic" \
    --project="${PROJECT_ID}" \
    >/dev/null 2>&1 \
    && echo "已建立 secret 容器：${name}" \
    || echo "secret ${name} 已存在，略過建立"

  echo
  read -r -s -p "貼上 ${prompt_label} 的實際金鑰值（輸入時不會顯示）: " secret_value
  echo
  if [[ -z "${secret_value}" ]]; then
    echo "沒有輸入任何內容，離開，不寫入 secret。"
    exit 1
  fi

  printf '%s' "${secret_value}" | gcloud secrets versions add "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}"
  unset secret_value

  echo "已寫入 ${name} 的新版本。"
}

# -----------------------------------------------------------------------------
# 3. 是否要更新 LLM provider 金鑰值
# -----------------------------------------------------------------------------
echo
upsert_secret "${SECRET_NAME}" "${SECRET_NAME}"
echo

# -----------------------------------------------------------------------------
# 4. 是否要更新 GOOGLE_PLACES_API_KEY —— 獨立於上面的 provider 選擇,供
#    geocode/recommend_nearby 兩個工具查詢 Google Places API(見
#    internal/wanttools/geocode.go、recommend_nearby.go)。目前 Secret Manager
#    裡完全沒有這個 secret、deploy-cloudrun.yml 也沒有引用,正式環境上這兩個
#    工具實際上是壞的(fallback 成「未設定,略過」)——這支腳本執行完後,還要
#    把 GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest 加進
#    deploy-cloudrun.yml 的 --update-secrets 才會真的生效。
# -----------------------------------------------------------------------------
upsert_secret "GOOGLE_PLACES_API_KEY" "Google Places API 金鑰"
echo

# -----------------------------------------------------------------------------
# 5. 摘要 —— AI_PROVIDER/AI_MODEL 不是機密，不進 Secret Manager，
#    印出來給你貼回去給我，我會據此更新 deploy-cloudrun.yml。AI_MODEL 只在
#    你第 2 步真的有輸入時才印出來；留空代表「不變」，這裡就不印，避免你
#    誤把它當成「要改成某個值」貼給我，結果覆蓋掉現有設定。
# -----------------------------------------------------------------------------
echo "=============================================="
echo " 完成。請把下面這幾行貼給我，我會更新"
echo " .github/workflows/deploy-cloudrun.yml："
echo "=============================================="
echo
echo "   AI_PROVIDER=${AI_PROVIDER}"
if [[ -n "${AI_MODEL}" ]]; then
  echo "   AI_MODEL=${AI_MODEL}"
else
  echo "   AI_MODEL=（不變，沿用 workflow 裡現有的值）"
fi
echo "   (secret: ${SECRET_NAME}=${SECRET_NAME}:latest)"
echo "   (secret: GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest)"
echo
echo "=============================================="
