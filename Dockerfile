# Tripace server 容器映像。
# build context 為「專案根目錄」,COPY 路徑相對根目錄寫(server/...)。
# server/go.mod 的 github.com/tim72117/want 透過 GOPRIVATE + GH_PAT
# 從 GitHub 下載(見下方 build 階段),不依賴本地 want/ 源碼。
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
# VITE_ONAGENT_APP_KEY:onagent 平台(tripace app)的 apiKey,同上放 Secret
# Manager,由 deploy-cloudrun.yml 讀出後當 --build-arg 傳入。
# VITE_ONAGENT_URL:onagent 平台位址,不是機密(見 web/.env.production.local
# 的說明),但正式站與本機開發指向不同網址,同樣需要在 build 時期決定,
# 故一併用 build-arg 傳入,不寫死在 Dockerfile 裡。
ARG VITE_ONAGENT_APP_KEY
ARG VITE_ONAGENT_URL
ENV VITE_ONAGENT_APP_KEY=${VITE_ONAGENT_APP_KEY}
ENV VITE_ONAGENT_URL=${VITE_ONAGENT_URL}
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

ARG GH_PAT
RUN git config --global url."https://${GH_PAT}@github.com/".insteadOf "https://github.com/"

# 先單獨複製 go.mod / go.sum 以利 layer 快取(相依沒變時不重抓)。
COPY server/go.mod server/go.sum /src/server/
RUN cd /src/server && GOPRIVATE=github.com/tim72117/want go mod download

# 再複製完整源碼。
COPY server/ /src/server/

# 把兩個前端 dist 放到各自的 embed 路徑。用 rm -rf 先清掉 checked-in 的
# placeholder index.html,避免殘留檔案混進真正的 build 產物。
RUN rm -rf /src/server/cmd/server/web/dist/* /src/server/cmd/server/webadmin/dist/*
COPY --from=web-build /web/dist/. /src/server/cmd/server/web/dist/
COPY --from=admin-build /webadmin/dist/. /src/server/cmd/server/webadmin/dist/

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
