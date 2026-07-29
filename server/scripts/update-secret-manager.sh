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
# GOOGLE_PLACES_API_KEY(後端 geocode/recommend_nearby 工具用)與
# GOOGLE_MAPS_API_KEY(前端 Maps JavaScript API 用)是獨立於 AI_PROVIDER 之外
# 的兩組金鑰,與 LLM provider 選的是 claude 還是 googleapis 無關。這兩把 key
# 刻意保持獨立(不同用途、不同 API 限制範圍、輪替互不影響),不是同一把 key
# 改名共用——這支腳本目前是 Cloud Run(shuttle-045094509 專案)唯一設定它們
# 的地方,故一併整合進來,不另外開一支腳本。
#
# 用法(擇一):
#   bash server/scripts/update-secret-manager.sh              # 全部類型都問一輪(預設)
#   bash server/scripts/update-secret-manager.sh -provider     # 只處理 LLM provider/model/金鑰
#   bash server/scripts/update-secret-manager.sh -places       # 只處理 GOOGLE_PLACES_API_KEY
#   bash server/scripts/update-secret-manager.sh -maps         # 只處理 GOOGLE_MAPS_API_KEY
# =============================================================================

set -euo pipefail

PROJECT_ID="shuttle-045094509"

DO_PROVIDER=1
DO_PLACES=1
DO_MAPS=1
case "${1:-}" in
  -provider)
    DO_PLACES=0
    DO_MAPS=0
    ;;
  -places)
    DO_PROVIDER=0
    DO_MAPS=0
    ;;
  -maps)
    DO_PROVIDER=0
    DO_PLACES=0
    ;;
  ""|-all)
    ;;
  *)
    echo "未知參數：$1（可用 -provider / -places / -maps，不帶參數則全部處理）" >&2
    exit 1
    ;;
esac

echo "=============================================="
echo " tripace AI_PROVIDER / Google Places 設定"
echo " PROJECT_ID = ${PROJECT_ID}"
echo "=============================================="
echo

# -----------------------------------------------------------------------------
# upsert_secret <secret 名稱>:互動詢問是否更新、要更新就建立容器(已存在則
# 略過)+ 隱藏輸入寫入新版本。抽成函式,因為 LLM provider 金鑰要走這套
# 「先問要不要換、換就整段互動輸入」流程 —— GOOGLE_PLACES_API_KEY 則走下面
# 專屬的 upsert_places_key(自動建立金鑰,不需手動貼值)。
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
# upsert_google_api_key <secret 名稱> <display 前綴> <api-target 服務清單...>:
# GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY 共用的建立邏輯,提供兩種模式:
#   1) 建立新金鑰:呼叫 gcloud services api-keys create 現場建立一把新金鑰
#      (限制在傳入的服務清單),立即用 curl 對 Places API 打一次驗證性請求
#      (即使是 Maps JS key,這個端點也能用來確認金鑰本身有效、Places 服務
#      限制是否生效——Maps JS API 本身沒有對應的簡單 REST 驗證端點,不需要
#      為它另外設計驗證方式,只是這個 HTTP 200 訊號的意義稍有不同),
#      再自動寫入 Secret Manager。
#   2) 貼上既有金鑰值:手上已經有一把金鑰,不需要/不想再申請一把新的,直接
#      貼值寫入 Secret Manager,跳過建立與驗證步驟 —— 走跟 upsert_secret
#      一樣的手動貼值流程。
# 這兩把 key 刻意保持獨立 secret、獨立 API key(見上方檔案開頭說明),故傳入
# 服務清單以支援不同的 API 限制範圍,不寫死成單一服務。
# -----------------------------------------------------------------------------
upsert_google_api_key() {
  local name="$1"
  local display_prefix="$2"
  shift 2
  local api_targets=("$@")

  echo "${name} 要怎麼處理？"
  echo "  1) 建立一把新金鑰(gcloud 現場申請 + 驗證 + 寫入)"
  echo "  2) 貼上既有金鑰值(手上已有金鑰,直接寫入 Secret Manager)"
  echo "  3) 略過，沿用 Secret Manager 裡現有的版本"
  read -r -p "輸入 1、2 或 3: " key_choice

  case "${key_choice}" in
    2)
      upsert_secret "${name}" "${name}"
      return 0
      ;;
    3|"")
      echo "略過 ${name} 更新 —— 沿用 Secret Manager 裡現有的版本。"
      return 0
      ;;
    1)
      ;;
    *)
      echo "沒有這個選項，略過 ${name} 更新。"
      return 0
      ;;
  esac

  local key_display_name="${display_prefix}-$(date +%Y%m%d 2>/dev/null || echo new)"
  local api_target_args=()
  for target in "${api_targets[@]}"; do
    api_target_args+=(--api-target="service=${target}")
  done
  echo "正在建立金鑰(限制服務：${api_targets[*]})…"

  local create_out
  create_out=$(gcloud services api-keys create \
    --project="${PROJECT_ID}" \
    --display-name="${key_display_name}" \
    "${api_target_args[@]}" \
    --format="value(response.keyString, name)" 2>&1) || {
      echo "✗ 建立金鑰失敗：" >&2
      echo "${create_out}" >&2
      exit 1
    }

  local key_string
  key_string=$(echo "${create_out}" | awk '{print $1}')
  if [[ -z "${key_string}" ]]; then
    echo "✗ 建立指令成功但沒取到 keyString，完整輸出：" >&2
    echo "${create_out}" >&2
    echo "可到 Console 查看：https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}" >&2
    exit 1
  fi
  echo "✓ 金鑰已建立"

  echo "驗證金鑰(打新版 Places API,確認金鑰本身有效)…"
  local verify_file http_code
  verify_file="$(mktemp)"
  # 查詢字串刻意用純英文(而非中文地名):部分終端機/shell 的 locale 不是
  # UTF-8 時,中文字串經過 shell 轉譯後可能不是合法 UTF-8 位元組序列,curl
  # 送出去的 request body 因此毀損,Google 前端會直接回一個 HTML 版「400
  # Bad Request」錯誤頁(不是 Places API 正常的 JSON 錯誤格式),看起來像是
  # 金鑰限制沒生效,實際上跟金鑰完全無關,是編碼問題。純英文可完全避開。
  http_code=$(curl -sS -o "${verify_file}" -w "%{http_code}" \
    -X POST "https://places.googleapis.com/v1/places:searchText" \
    -H "Content-Type: application/json" \
    -H "X-Goog-Api-Key: ${key_string}" \
    -H "X-Goog-FieldMask: places.displayName,places.formattedAddress,places.location" \
    -d '{"textQuery":"Hilton Miyakojima Resort","pageSize":1}')

  if [[ "${http_code}" == "200" ]]; then
    echo "✓ HTTP 200 — 金鑰可用(若這把 key 未限制 Places API,這裡預期會是"
    echo "  403/PERMISSION_DENIED,屬正常現象,不代表金鑰本身有問題)"
  else
    echo "△ HTTP ${http_code} — 金鑰剛建立，限制可能尚未生效(通常數十秒~數分鐘)，" >&2
    echo "  或這把 key 本來就沒開放 Places API(如為 Maps JS 專用 key，屬正常現象)" >&2
    echo "  Google 回傳：$(cat "${verify_file}")" >&2
  fi
  rm -f "${verify_file}"

  gcloud secrets create "${name}" \
    --replication-policy="automatic" \
    --project="${PROJECT_ID}" \
    >/dev/null 2>&1 \
    && echo "已建立 secret 容器：${name}" \
    || echo "secret ${name} 已存在，略過建立"

  printf '%s' "${key_string}" | gcloud secrets versions add "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}"
  unset key_string

  echo "已寫入 ${name} 的新版本。"
}

# -----------------------------------------------------------------------------
# 3. LLM provider：選 provider/model + 是否要更新金鑰值。只在 -provider 或
#    不帶參數(兩者都跑)時執行；只想處理 Places 金鑰時(-places)完全略過，
#    不會被迫選 provider。
# -----------------------------------------------------------------------------
if [[ "${DO_PROVIDER}" == "1" ]]; then
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

  # model 留空真正代表「不變」：這支腳本不知道 deploy-cloudrun.yml 裡現在
  # 實際設定的是哪個 model，所以留空時不套用任何值（包括上面的
  # DEFAULT_MODEL），只在你真的想指定新 model 時才印出來，讓摘要不會意外
  # 覆蓋你已經在用、腳本並不知情的設定。
  read -r -p "要用哪個 model？(直接按 Enter 表示不變，或輸入新值，例如 ${DEFAULT_MODEL}): " AI_MODEL
  if [[ -z "${AI_MODEL}" ]]; then
    echo "略過 model 設定 —— deploy-cloudrun.yml 裡現有的 AI_MODEL 沿用不變。"
  fi

  echo
  upsert_secret "${SECRET_NAME}" "${SECRET_NAME}"
  echo
fi

# -----------------------------------------------------------------------------
# 4. GOOGLE_PLACES_API_KEY —— 獨立於上面的 provider 選擇,供
#    geocode/recommend_nearby 兩個工具查詢 Google Places API(見
#    internal/wanttools/geocode.go、recommend_nearby.go)。只在 -places 或
#    不帶參數(兩者都跑)時執行；只想處理 provider 時(-provider)完全略過。
# -----------------------------------------------------------------------------
if [[ "${DO_PLACES}" == "1" ]]; then
  upsert_google_api_key "GOOGLE_PLACES_API_KEY" "channel-places" \
    "places.googleapis.com" "places-backend.googleapis.com"
  echo
fi

# -----------------------------------------------------------------------------
# 4b. GOOGLE_MAPS_API_KEY —— 前端 Maps JavaScript API 用(見
#     web/src/PaceRouteMap.tsx、RecommendedPlacesMap.tsx 的 apiKey),透過
#     Dockerfile 的 web-build 階段以 --build-arg 編入前端 bundle,故 build
#     時 CI 需要能讀到這把 key(見 deploy-cloudrun.yml 的
#     "Read Google Maps API key from Secret Manager" step)。刻意跟
#     GOOGLE_PLACES_API_KEY 分開成兩把 key(用途、API 限制範圍都不同,見
#     檔案開頭說明),只在 -maps 或不帶參數(全部處理)時執行。
# -----------------------------------------------------------------------------
if [[ "${DO_MAPS}" == "1" ]]; then
  upsert_google_api_key "GOOGLE_MAPS_API_KEY" "tripace-maps" \
    "maps-backend.googleapis.com"
  echo
fi

# -----------------------------------------------------------------------------
# 5. 摘要 —— AI_PROVIDER/AI_MODEL 不是機密，不進 Secret Manager，
#    印出來給你貼回去給我，我會據此更新 deploy-cloudrun.yml。AI_MODEL 只在
#    你真的有輸入時才印出來；留空代表「不變」，這裡就不印，避免你誤把它
#    當成「要改成某個值」貼給我，結果覆蓋掉現有設定。只印出這次實際有跑
#    過的類型，避免 -provider/-places/-maps 單獨執行時印出沒處理過的項目。
# -----------------------------------------------------------------------------
echo "=============================================="
echo " 完成。"
if [[ "${DO_PROVIDER}" == "1" || "${DO_PLACES}" == "1" || "${DO_MAPS}" == "1" ]]; then
  echo " 請把下面這幾行貼給我，我會更新"
  echo " .github/workflows/deploy-cloudrun.yml："
fi
echo "=============================================="
echo

if [[ "${DO_PROVIDER}" == "1" ]]; then
  echo "   AI_PROVIDER=${AI_PROVIDER}"
  if [[ -n "${AI_MODEL}" ]]; then
    echo "   AI_MODEL=${AI_MODEL}"
  else
    echo "   AI_MODEL=（不變，沿用 workflow 裡現有的值）"
  fi
  echo "   (secret: ${SECRET_NAME}=${SECRET_NAME}:latest)"
fi

if [[ "${DO_PLACES}" == "1" ]]; then
  echo "   (secret: GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest)"
fi

if [[ "${DO_MAPS}" == "1" ]]; then
  echo "   (secret: GOOGLE_MAPS_API_KEY，deploy-cloudrun.yml build 階段讀取)"
fi

echo
echo "=============================================="
