#!/usr/bin/env bash
# =============================================================================
# tripace — 互動式設定 Google Places/Maps/onagent 相關的 Secret Manager secret
#
# 這支腳本會問你要不要換金鑰，直接在這支腳本裡完成 Secret Manager 的寫入
# —— 不會印出金鑰本身、不會把金鑰寫進任何檔案，金鑰只在這次執行的記憶體中
# 短暫存在。
#
# GOOGLE_PLACES_API_KEY(後端 geocode/recommend_nearby 工具用)、
# GOOGLE_MAPS_API_KEY(前端 Maps JavaScript API 用)、
# GOOGLE_MAPS_MAP_ID(前端 GeoOutlineMap.tsx 的 AdvancedMarkerElement 要求
# 的地圖樣式 ID)、VITE_ONAGENT_APP_KEY(前端 onagent 平台 tripace app 的
# apiKey)是四組獨立的金鑰/識別碼,不同用途、不同申請/輪替方式,互不影響。
# 這支腳本目前是 Cloud Run(shuttle-045094509 專案)唯一設定它們的地方,
# 故一併整合進來,不另外開一支腳本。
#
# VITE_ONAGENT_APP_KEY 跟前兩把 Google key 的關鍵差異:Google key 可以用
# gcloud 現場申請新的(見 upsert_google_api_key);onagent 平台的 apiKey
# 只能用 onagent CLI(`onagent issue-key <appId>`)另外核發,這支腳本沒有
# 呼叫 onagent CLI 的能力,也不該代管——故 -onagent 只支援「貼上既有值」
# 一種模式(走 upsert_secret,同 upsert_google_api_key 選項 2 的邏輯),
# 不提供現場申請選項。這把 key 只顯示一次、重發會讓舊 key 立刻失效,見
# .claude/skills/onagent-cli-setup 的說明。
#
# 原本這支腳本還包含 LLM provider(AI_PROVIDER/AI_MODEL/ANTHROPIC_API_KEY/
# GOOGLE_API_KEY)的互動設定流程,隨 tripace 自家 want 對話系統整套移除
# (2026-08-11,見 deploy-cloudrun.yml 對應的環境變數同批移除)一併刪除
# ——那組設定原本就是配合 want_analyzer.go NewWant() 選 LLM provider 用的,
# want 移除後已無任何程式碼路徑會讀,繼續保留這段互動流程只會誤導使用者
# 以為改了還有效果。
#
# 用法(擇一):
#   bash server/scripts/update-secret-manager.sh                     # 全部類型都問一輪(預設)
#   bash server/scripts/update-secret-manager.sh -places              # 只處理 GOOGLE_PLACES_API_KEY
#   bash server/scripts/update-secret-manager.sh -maps                # 只處理 GOOGLE_MAPS_API_KEY
#   bash server/scripts/update-secret-manager.sh -map-id              # 只處理 GOOGLE_MAPS_MAP_ID
#   bash server/scripts/update-secret-manager.sh -onagent             # 只處理 VITE_ONAGENT_APP_KEY
#   bash server/scripts/update-secret-manager.sh -cleanup-legacy-provider
#       # 刪除已隨 want 移除而不再使用的 ANTHROPIC_API_KEY/GOOGLE_API_KEY
#       # secret 容器(互動逐一確認,不影響上面四種一般用法)——刻意獨立成
#       # 專屬旗標、不併入 -all 預設流程,避免一般使用者在沒注意到的情況下
#       # 誤刪 secret(刪除是不可逆操作,見下方 cleanup_legacy_provider_secret)。
# =============================================================================

set -euo pipefail

PROJECT_ID="shuttle-045094509"

# print_usage:跟檔案開頭「用法」註解區塊內容一致，供 -h/--help 印出，
# 也在收到未知參數時附帶印出，避免使用者只看到一行錯誤訊息、還要另外翻
# 原始碼開頭註解才知道有哪些參數可用。
print_usage() {
  cat <<'EOF'
用法(擇一):
  (不帶參數)              全部類型都問一輪(預設)
  -places                  只處理 GOOGLE_PLACES_API_KEY
  -maps                    只處理 GOOGLE_MAPS_API_KEY
  -map-id                  只處理 GOOGLE_MAPS_MAP_ID
  -onagent                 只處理 VITE_ONAGENT_APP_KEY
  -cleanup-legacy-provider 刪除已隨 want 移除而不再使用的
                           ANTHROPIC_API_KEY/GOOGLE_API_KEY secret 容器
                           (互動逐一確認,不影響上面四種一般用法)
  -h, --help               顯示這份說明
EOF
}

DO_PLACES=1
DO_MAPS=1
DO_MAP_ID=1
DO_ONAGENT=1
DO_CLEANUP_LEGACY_PROVIDER=0
case "${1:-}" in
  -places)
    DO_MAPS=0
    DO_MAP_ID=0
    DO_ONAGENT=0
    ;;
  -maps)
    DO_PLACES=0
    DO_MAP_ID=0
    DO_ONAGENT=0
    ;;
  -map-id)
    DO_PLACES=0
    DO_MAPS=0
    DO_ONAGENT=0
    ;;
  -onagent)
    DO_PLACES=0
    DO_MAPS=0
    DO_MAP_ID=0
    ;;
  -cleanup-legacy-provider)
    DO_PLACES=0
    DO_MAPS=0
    DO_MAP_ID=0
    DO_ONAGENT=0
    DO_CLEANUP_LEGACY_PROVIDER=1
    ;;
  -h|--help)
    print_usage
    exit 0
    ;;
  ""|-all)
    ;;
  *)
    echo "未知參數：$1" >&2
    echo >&2
    print_usage >&2
    exit 1
    ;;
esac

echo "=============================================="
echo " tripace Google Places / Maps 金鑰設定"
echo " PROJECT_ID = ${PROJECT_ID}"
echo "=============================================="
echo

# -----------------------------------------------------------------------------
# upsert_secret <secret 名稱>:互動詢問是否更新、要更新就建立容器(已存在則
# 略過)+ 隱藏輸入寫入新版本。抽成函式,供 upsert_google_api_key 選項 2
# 「貼上既有金鑰值」呼叫(自動建立金鑰、不需手動貼值的路徑則走
# upsert_google_api_key 自己的邏輯,不經過這裡)。
# -----------------------------------------------------------------------------
upsert_secret() {
  local name="$1"
  local prompt_label="$2"

  read -r -p "要更新 ${name} 的金鑰值嗎？(y/N，不更新請直接按 Enter 或輸入 N): " update_choice
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
# cleanup_legacy_provider_secret <secret 名稱>:互動確認後刪除一個 Secret
# Manager 容器(gcloud secrets delete),供下面清理 ANTHROPIC_API_KEY/
# GOOGLE_API_KEY 用——這兩把 key 隨 tripace 自家 want 對話系統整套移除
# (2026-08-11)已無任何程式碼路徑會讀,繼續留在 Secret Manager 裡只是
# 佔用、容易被誤以為還在生效。每把 key 各自問一次(y/N),預設不刪除
# (直接按 Enter 等同輸入 N),避免不小心誤刪;secret 不存在時
# gcloud secrets delete 本身就會回報「找不到」,這裡不特別預先檢查存在性。
# -----------------------------------------------------------------------------
cleanup_legacy_provider_secret() {
  local name="$1"

  read -r -p "要刪除 Secret Manager 裡的 ${name} 嗎？此操作不可逆(y/N): " delete_choice
  if [[ ! "${delete_choice}" =~ ^[Yy]$ ]]; then
    echo "略過 ${name}，未刪除。"
    return 0
  fi

  gcloud secrets delete "${name}" \
    --project="${PROJECT_ID}" \
    --quiet \
    && echo "已刪除 ${name}。" \
    || echo "刪除 ${name} 失敗（可能本來就不存在，見上方 gcloud 錯誤訊息）。"
}

if [[ "${DO_CLEANUP_LEGACY_PROVIDER}" == "1" ]]; then
  echo "即將逐一確認是否刪除已隨 want 對話系統移除、目前無程式碼讀取的 secret："
  echo
  cleanup_legacy_provider_secret "ANTHROPIC_API_KEY"
  cleanup_legacy_provider_secret "GOOGLE_API_KEY"
  echo
  echo "=============================================="
  echo " 清理完成。"
  echo "=============================================="
  exit 0
fi

# -----------------------------------------------------------------------------
# 3. GOOGLE_PLACES_API_KEY —— 供 geocode/recommend_nearby 兩個工具查詢
#    Google Places API(見 internal/onagenttools/geocode.go、
#    recommend_nearby.go)。只在 -places 或不帶參數(兩者都跑)時執行。
# -----------------------------------------------------------------------------
if [[ "${DO_PLACES}" == "1" ]]; then
  upsert_google_api_key "GOOGLE_PLACES_API_KEY" "channel-places" \
    "places.googleapis.com" "places-backend.googleapis.com"
  echo
fi

# -----------------------------------------------------------------------------
# 4. GOOGLE_MAPS_API_KEY —— 前端 Maps JavaScript API 用(見
#    web/src/PaceRouteMap.tsx、RecommendedPlacesMap.tsx 的 apiKey),透過
#    Dockerfile 的 web-build 階段以 --build-arg 編入前端 bundle,故 build
#    時 CI 需要能讀到這把 key(見 deploy-cloudrun.yml 的
#    "Read Google Maps API key from Secret Manager" step)。刻意跟
#    GOOGLE_PLACES_API_KEY 分開成兩把 key(用途、API 限制範圍都不同,見
#    檔案開頭說明),只在 -maps 或不帶參數(全部處理)時執行。
# -----------------------------------------------------------------------------
if [[ "${DO_MAPS}" == "1" ]]; then
  upsert_google_api_key "GOOGLE_MAPS_API_KEY" "tripace-maps" \
    "maps-backend.googleapis.com"
  echo
fi

# -----------------------------------------------------------------------------
# 4b. GOOGLE_MAPS_MAP_ID —— 前端 GeoOutlineMap.tsx 的
#     google.maps.marker.AdvancedMarkerElement 要求地圖必須帶 mapId 才能
#     運作(Google 官方規定),對應 GCP Console → Maps Platform → Map
#     Management 手動建立的 Cloud-based Map Style ID。跟上面兩把 Google
#     key 不同,這不是能用 gcloud 現場申請的 API key,只能到 Console 手動
#     建立樣式後貼上既有值(同 VITE_ONAGENT_APP_KEY 的模式,走
#     upsert_secret,不支援現場建立選項)。透過 Dockerfile 的 web-build
#     階段以 --build-arg 編入前端 bundle(見 deploy-cloudrun.yml 的
#     "Read Google Maps Map ID from Secret Manager" step)。不是機密資料
#     (Map ID 本身不具敏感性,前端 bundle 裡本來就看得到),放 Secret
#     Manager純粹是為了集中管理、換樣式不用改 workflow 檔案。只在 -map-id
#     或不帶參數(全部處理)時執行。
# -----------------------------------------------------------------------------
if [[ "${DO_MAP_ID}" == "1" ]]; then
  upsert_secret "GOOGLE_MAPS_MAP_ID" "GOOGLE_MAPS_MAP_ID(GCP Console → Maps Platform → Map Management 建立的 Map Style ID)"
  echo
fi

# -----------------------------------------------------------------------------
# 5. VITE_ONAGENT_APP_KEY —— onagent 平台 tripace app 的 apiKey,前端
#    OnagentBridgeDemo.tsx/useOnagentChatBridge.ts 讀取,透過 Dockerfile 的
#    web-build 階段以 --build-arg 編入前端 bundle(見 deploy-cloudrun.yml
#    的 "Read onagent app key from Secret Manager" step)。只支援貼上既有
#    值(見檔案開頭「VITE_ONAGENT_APP_KEY 跟前兩把 Google key 的關鍵差異」
#    說明,這裡沒有現場申請新 key 的能力)——要換 key 時,先自己手動跑
#    `onagent issue-key tripace`(或到 onagent console 按 Issue key)拿到
#    明文,再回來這裡貼上。只在 -onagent 或不帶參數(全部處理)時執行。
# -----------------------------------------------------------------------------
if [[ "${DO_ONAGENT}" == "1" ]]; then
  upsert_secret "VITE_ONAGENT_APP_KEY" "VITE_ONAGENT_APP_KEY(onagent tripace app 的 apiKey,先跑 onagent issue-key tripace 取得)"
  echo
fi

# -----------------------------------------------------------------------------
# 6. 摘要 —— 只印出這次實際有跑過的類型，避免 -places/-maps/-onagent 單獨
#    執行時印出沒處理過的項目。
# -----------------------------------------------------------------------------
echo "=============================================="
echo " 完成。"
echo "=============================================="
echo

if [[ "${DO_PLACES}" == "1" ]]; then
  echo "   (secret: GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest)"
fi

if [[ "${DO_MAPS}" == "1" ]]; then
  echo "   (secret: GOOGLE_MAPS_API_KEY，deploy-cloudrun.yml build 階段讀取)"
fi

if [[ "${DO_MAP_ID}" == "1" ]]; then
  echo "   (secret: GOOGLE_MAPS_MAP_ID，deploy-cloudrun.yml build 階段讀取)"
fi

if [[ "${DO_ONAGENT}" == "1" ]]; then
  echo "   (secret: VITE_ONAGENT_APP_KEY，deploy-cloudrun.yml build 階段讀取)"
fi

echo
echo "=============================================="
