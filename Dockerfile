# Tripace server 容器映像。
# build context 為「專案根目錄」,COPY 路徑相對根目錄寫(server/...)。
#
# 有兩個獨立 Vite 專案(web、web/admin),各自 build 後複製進
# server/cmd/server/{web,webadmin}/dist/,對應 cmd/server/static.go 的
# go:embed web/dist、cmd/server/static_admin.go 的 go:embed webadmin/dist
# ——路徑名稱必須完全一致,否則 embed 到的只會是 checked-in 的 placeholder
# index.html(參考 c:\www\my\agent\Dockerfile 的同款多前端合併編譯模式)。
# web/admin 的建置產物預設不會被使用:main.go 的 -admin flag/ADMIN_ENABLED
# 環境變數未開啟時,cmd/server 這支主 binary 完全不會掛載 /admin/* 路由,
# 這份 embed 進去的內容形同沒有作用——只是讓「將來想合併部署」的情境不需要
# 先補這一步 Dockerfile 才能用,cmd/adminserver 獨立部署路徑完全不受影響。
#
# 建置(從專案根目錄):
#   docker build -t tripace-server .
# 本機跑(env 由 --env-file 注入,不會把 .env 烤進映像):
#   docker run --rm -p 8080:8080 --env-file server/.env tripace-server

# ---- 階段 1:build 主前端 ----
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Vite 只在 build 當下讀取 VITE_* 環境變數並編譯進 bundle,故用 ARG 轉 ENV
# 讓 npm run build 讀得到;金鑰本身放 GCP Secret Manager,由
# deploy-cloudrun.yml 在呼叫 docker build 前讀出再當 --build-arg 傳入。
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
# VITE_GOOGLE_MAPS_MAP_ID:GeoOutlineMap.tsx 的 AdvancedMarkerElement 要求
# 地圖必須帶 mapId 才能運作(Google 官方規定,見該檔案的說明),對應 GCP
# Console Map Style 的自訂樣式 ID——不是機密資料,不需要走 Secret Manager,
# 直接用一般 build-arg 傳入。
ARG VITE_GOOGLE_MAPS_MAP_ID
ENV VITE_GOOGLE_MAPS_MAP_ID=${VITE_GOOGLE_MAPS_MAP_ID}
# VITE_GOOGLE_MAPS_LANDING_MAP_ID:InteractiveExploreMap.tsx(九份/京都/
# 台南安平/赤崁・府城等主題介紹頁地圖)專用的 Cloud Style Map ID,對應
# docs/map-style/light-simple.json/dark-simple.json 這份「所有 POI 標籤
# 都關閉」的樣式快照——理由同上面 VITE_GOOGLE_MAPS_MAP_ID,不是機密資料
# 但集中放 Secret Manager 管理。2026-10 補上之前:deploy-cloudrun.yml
# 沒有傳這個 build-arg,正式環境的這個環境變數永遠是 undefined,
# NativeMapBase 的 mapId prop 會自動退回上面的 VITE_GOOGLE_MAPS_MAP_ID
# (正式規劃功能同一份樣式,含完整原生 POI 標籤),代表正式環境的主題
# 介紹頁地圖從未真正套用過這份客製化樣式。
ARG VITE_GOOGLE_MAPS_LANDING_MAP_ID
ENV VITE_GOOGLE_MAPS_LANDING_MAP_ID=${VITE_GOOGLE_MAPS_LANDING_MAP_ID}
# VITE_ONAGENT_APP_KEY:onagent 平台(tripace app)的 apiKey,同上放 Secret
# Manager,由 deploy-cloudrun.yml 讀出後當 --build-arg 傳入。
# VITE_ONAGENT_URL:onagent 平台位址,不是機密(見 web/.env.production.local
# 的說明),但正式站與本機開發指向不同網址,同樣需要在 build 時期決定,
# 故一併用 build-arg 傳入,不寫死在 Dockerfile 裡。
ARG VITE_ONAGENT_APP_KEY
ARG VITE_ONAGENT_URL
ENV VITE_ONAGENT_APP_KEY=${VITE_ONAGENT_APP_KEY}
ENV VITE_ONAGENT_URL=${VITE_ONAGENT_URL}
# VITE_GOOGLE_OAUTH_CLIENT_ID:Google 帳號登入(GSI 模式,LoginForm.tsx/
# useGoogleSignIn.ts)用的 OAuth 用戶端 ID——不是機密（Google OAuth client
# ID 設計上本來就會出現在前端程式碼裡，真正的機密是後端才有的
# GOOGLE_OAUTH_CLIENT_SECRET，但這裡沒有用到 client secret，tripace 走的
# 是後端用 idtoken.Validate 驗證 ID Token 的 GSI 模式，見
# server/internal/auth/google.go），仍放 Secret Manager 集中管理，理由同
# VITE_GOOGLE_MAPS_MAP_ID：換值只需更新 Secret Manager 版本，不需要另外
# 同步 GitHub Secrets。由 deploy-cloudrun.yml 讀出後當 --build-arg 傳入。
ARG VITE_GOOGLE_OAUTH_CLIENT_ID
ENV VITE_GOOGLE_OAUTH_CLIENT_ID=${VITE_GOOGLE_OAUTH_CLIENT_ID}
# VITE_PLAN_AI_ONAGENT_APP_KEY:「AI 規劃」功能(/app/plan-ai,見
# web/src/trip-plan/TripPlanPage.tsx)專用的獨立 onagent app
# (plan-ai-timeline)的 apiKey,跟上面 VITE_ONAGENT_APP_KEY(tripace app)
# 是完全不同的兩個 app、兩把互不相關的 key,見 TripPlanPage.tsx
# PLAN_AI_ONAGENT_APP_ID 的完整說明。放 Secret Manager,由
# deploy-cloudrun.yml 讀出後當 --build-arg 傳入。
#
# 2026-09:這個 app 的 URL 不再有獨立的 VITE_PLAN_AI_ONAGENT_URL——使用者
# 明確要求合併成同一個環境變數名稱,直接沿用上面的 VITE_ONAGENT_URL(兩個
# onagent app 目前剛好指向同一個平台網址)。
ARG VITE_PLAN_AI_ONAGENT_APP_KEY
ENV VITE_PLAN_AI_ONAGENT_APP_KEY=${VITE_PLAN_AI_ONAGENT_APP_KEY}
RUN npm run build

# ---- 階段 1b:build admin 後台前端 ----
# 獨立的 web/admin SPA(系統管理員後台),跟主前端一樣 build 進預設 dist,
# 之後複製進 server/cmd/server/webadmin/dist/(go:embed 目標)。
FROM node:22-alpine AS admin-build
WORKDIR /webadmin
COPY web/admin/package.json web/admin/package-lock.json ./
RUN npm ci
COPY web/admin/ ./
RUN npm run build

# ---- 階段 2:編譯 Go ----
FROM golang:1.26 AS build

# 先單獨複製 go.mod / go.sum 以利 layer 快取(相依沒變時不重抓)。
# go.mod 已無私有依賴(internal/wanttools 對 github.com/tim72117/want 的
# 依賴已移除,型別改為本地定義,見 server/internal/wanttools/wanttypes.go),
# 故不再需要 GH_PAT/GOPRIVATE 這組私有模組認證設定。
COPY server/go.mod server/go.sum /src/server/
RUN cd /src/server && go mod download

# 再複製完整源碼。
COPY server/ /src/server/

# 把兩個前端 dist 放到各自的 embed 路徑。用 rm -rf 先清掉 checked-in 的
# placeholder index.html,避免殘留檔案混進真正的 build 產物。
RUN rm -rf /src/server/cmd/server/web/dist/* /src/server/cmd/server/webadmin/dist/*
COPY --from=web-build /web/dist/. /src/server/cmd/server/web/dist/
COPY --from=admin-build /webadmin/dist/. /src/server/cmd/server/webadmin/dist/

# 這裡是整個 build 流程裡唯一真正拿到前端 build 產物(而非 checked-in
# 的 placeholder index.html,見上方 rm -rf 的說明)的時間點——
# seo_meta_test.go 的測試(驗證 applySEOMeta() 字串取代是否仍精確比對
# web/dist/index.html,見該檔案的完整說明)在開發機/一般 CI 跑 go test
# 時,讀到的永遠是 placeholder、全部被判定成「還沒 build」而 SKIP,從未
# 真正驗證過;唯一能讓這組測試真正執行的地方就是這裡(真實 dist 已複製
# 進 embed 目錄之後、go build 之前)。不在這裡跑,這組測試形同虛設——
# index.html 格式只要改了(例如前端調整 meta 標籤縮排、Vite 版本升級
# 改變輸出格式),這個字串取代邏輯會靜默失效(找不到比對目標就直接跳過,
# 不報錯),卻完全不會被任何地方發現,直到真的重新去 curl 正式環境才會
# 注意到。-run 只跑這組測試,不跑全部 server 測試套件(那些不需要依賴
# 真實前端 build 產物,放在一般開發流程的 go test 裡執行即可,不需要
# 綁在這個已經很長的 Docker build 階段)。
#
# 2026-10 code review 抓到:go test -run 的 pattern 對不到任何測試時
# (例如測試改名、拼字打錯),只會印一行「no tests to run」並仍然以
# exit code 0 結束,不會讓這個 RUN 步驟失敗——Docker build 會誤以為
# 驗證通過,實際上這組測試完全沒有被執行過。兩道防線補上這個洞:
# 1. 先用 go test -list 把 pattern 應該比對到的測試名稱列出來,用 grep
#    -c 確認剛好對到 4 個(跟下面實際要跑的測試數量一致),對不到就讓
#    這一步直接失敗,而不是等 go test 本身默默跳過。
# 2. SEO_META_TEST_REQUIRE_REAL_BUILD=1 讓 readRealIndexHTML(見
#    seo_meta_test.go)在這個階段原本該 skip 的情況(web/dist/index.html
#    讀取失敗、或仍是 placeholder)直接判定測試失敗,而不是放行──這個
#    階段理論上一定拿得到真實建置產物(見上方 COPY --from=web-build 的
#    說明),不該出現 skip。
RUN cd /src/server && test "$(go test ./cmd/server/ -list 'TestApplySEOMeta|TestStaticHandler' | grep -c '^Test')" = "4"
RUN cd /src/server && SEO_META_TEST_REQUIRE_REAL_BUILD=1 go test ./cmd/server/ -run 'TestApplySEOMeta|TestStaticHandler' -v

# 靜態編譯:關 CGO 產出不依賴 libc 的單一執行檔,可放進極小的 base image。
RUN cd /src/server && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/server ./cmd/server

# ---- 階段 3:執行 ----
# distroless:只含執行檔需要的最小 runtime,無 shell、體積小、攻擊面小。
# 內含 CA 憑證,連 Cloud SQL(sslmode=require)的 TLS 才驗得過。
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server

# Cloud Run 會注入 PORT(預設 8080);main.go 讀 PORT 覆寫監聽位址。
EXPOSE 8080
ENTRYPOINT ["/app/server"]
