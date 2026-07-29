# Firebase App Check 是否適用於 Tripace

這份文件記錄 Firebase App Check 的用途、判斷準則,以及套用到這個專案目前的
Google Maps 金鑰配置時的結論——是否需要導入、為什麼。

## App Check 是什麼

App Check 保護應用程式對 Google 地圖平台發出的呼叫,擋掉非正當應用程式來源
的流量。做法是驗證供應商(例如 reCAPTCHA Enterprise)核發的權杖,只有通過
驗證的請求才會被放行。整合 App Check 的目的是防範惡意/未授權的 API 呼叫,
避免因此產生非預期費用。

## 官方建議的適用範圍

Google 官方文件指出,大多數情況下建議使用 App Check,但以下情境不需要、
也不支援:

| 情境 | 說明 |
|---|---|
| 使用原始版 Places SDK | App Check 只支援 Places SDK(新版) |
| 私人/實驗性應用程式 | 不開放公眾存取時不需要 |
| 純伺服器對伺服器通訊 | 若呼叫 GMP 的伺服器本身是被公開用戶端(如行動 App)使用,應保護該伺服器本身,而不是直接對 GMP 套 App Check |

## 對照 Tripace 目前的金鑰配置

專案目前有兩把獨立的 Google API 金鑰,職責明確分工(見
`server/internal/api/pace_route.go`、`entry_geocode.go`):

- **`VITE_GOOGLE_MAPS_API_KEY`**:瀏覽器端使用,只負責 Maps JavaScript API
  的地圖渲染(`PaceRouteMap.tsx`)。這把 key 會出現在前端打包後的程式碼裡,
  是唯一暴露在公開用戶端的金鑰。
- **`GOOGLE_PLACES_API_KEY`**:後端使用,負責 Places API(新版)/Routes API
  (`computeRoutes`)等計算類 REST 呼叫(`pace_route.go`、`entry_geocode.go`
  的 `handleComputeRouteFromEntries`)。這把 key 完全不會傳到瀏覽器,只存在
  於後端環境變數。

這個分工本身就是官方文件建議的「伺服器對伺服器通訊改保護伺服器本身」的
落地——`GOOGLE_PLACES_API_KEY` 不需要 App Check,因為它從未暴露給公開用戶端;
真正需要考慮 App Check 的,是暴露在瀏覽器端的 `VITE_GOOGLE_MAPS_API_KEY`。

## 結論與建議

1. **`GOOGLE_PLACES_API_KEY`(後端)**:不需要 App Check。這把金鑰只在
   `server/internal/api` 這一層被使用,前端完全不會接觸到它,風險已經靠
   「不外流」這個更根本的方式排除。真正該做的防護是後端既有的
   `internalAuth`(自家 JWT)機制,以及 GCP Console 上針對這把 key 的
   API 限制(只開放 Places API (New)/Routes API)與(若支援)IP 限制。

2. **`VITE_GOOGLE_MAPS_API_KEY`(前端)**:是唯一符合「暴露給公開用戶端」
   這個 App Check 適用情境的金鑰。是否要導入,取決於專案目前所處的階段:
   - 若 Tripace 仍是**私人/實驗性應用程式**(尚未對外公開、僅內部/受邀
     使用者存取)——依官方準則,現階段可以不用 App Check,先靠 GCP
     Console 既有的 **HTTP referrer 限制**(限制這把 key 只能從
     `tripace` 的正式網域呼叫)做基本防護即可,成本較低。
   - 若之後**正式對外公開**(任何人都能開啟網站、進而讓瀏覽器夾帶這把
     key 發出請求),屆時應該導入 App Check(搭配 reCAPTCHA Enterprise),
     才能有效阻擋別人抓包這把 key 後拿去別處濫用的情境——單靠 referrer
     限制在這個階段防護力有限(referrer header 可被偽造)。

3. 官方文件提到的「原始版 Places SDK 不支援」這一條與 Tripace 無關——專案
   查證過的既有結論是本身就只使用 Places API(新版)/Routes API,沒有走
   舊版 SDK(見 `PaceRouteMap.tsx` 開頭關於 DirectionsService 被
   REQUEST_DENIED 拒絕、改走新版 REST 端點的說明)。

**現階段建議**:先以 GCP Console 的 HTTP referrer 限制保護
`VITE_GOOGLE_MAPS_API_KEY`,待產品正式對外公開、有實際的公開流量規模時,
再評估導入 App Check + reCAPTCHA Enterprise——不需要現在就投入。
