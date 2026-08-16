# GCP 組織設定(待辦,晚點處理)

目前 `onagent-prod`、`shuttle-045094509` 都是無父層的獨立專案(`gcloud organizations list`
回傳 0 筆)。目前用手動跨專案 IAM 授權(見 `server/.env.example` 與
`.github/workflows/deploy-cloudrun.yml` 的 Cloud SQL 設定)就夠用;等專案數量變多、
手動授權變麻煩時,可依下列步驟建組織。

## 前提

- 需要一個網域(已有)
- **不能用個人 Gmail 帳號**,需申請 **Cloud Identity 免費版**,綁定該網域
- 組織節點本身免費,只有實際用的資源(Cloud SQL、Cloud Run 等)才收費

## 步驟

1. **申請 Cloud Identity 免費版**
   https://cloud.google.com/identity/docs/set-up-cloud-identity-admin
   - 用網域註冊,需完成 DNS TXT 記錄驗證網域所有權
   - 之後會建立一個管理員帳號(例如 `admin@yourdomain.com`),之後 GCP 專案都用這個身分下的
     使用者/服務帳號管理

2. **把現有專案移入組織**
   ```
   gcloud beta projects move onagent-prod --organization=ORG_ID
   gcloud beta projects move shuttle-045094509 --organization=ORG_ID
   ```
   需要對應專案的 owner 權限,且移動後帳單/IAM 政策繼承組織設定,需先確認不會中斷正在跑的服務。

3. **(可選)建資料夾分組管理**
   ```
   gcloud resource-manager folders create --display-name="Shuttle 相關專案" \
     --organization=ORG_ID
   gcloud beta projects move onagent-prod --folder=FOLDER_ID
   gcloud beta projects move shuttle-045094509 --folder=FOLDER_ID
   ```
   之後在資料夾層級 `add-iam-policy-binding`,底下所有專案(含未來新建的)自動繼承權限,
   不用每個專案手動加一次。

4. **(可選)用 Google Group 取代逐一列出 service account**
   建 `cloud-sql-clients@yourdomain.com` 群組,把要連 Cloud SQL 的各專案 service account
   都加進去,`roles/cloudsql.client` 只需要授權給這個群組一次;之後新專案只要把新的
   service account 加進群組即可,不用再碰 Cloud SQL 那邊的 IAM。

5. **(未來、規模更大時可考慮)Shared VPC**
   把 Cloud SQL 改成私有 IP,放進共用 VPC,其他專案以「服務專案」身分接入,徹底不走
   公開網路。設定複雜度較高,目前規模(2-3 個專案)不需要。

## 現況(不設組織也能運作的方式)

跨專案共用 Cloud SQL 目前是這樣做的(已完成,可參考做法套用到未來新專案):

```
# 1. 在 Cloud SQL 所在專案新增 database/user(見 gcloud sql databases/users create)
# 2. 把要連線的 Cloud Run 執行身分,加進 Cloud SQL 所在專案的 IAM
gcloud projects add-iam-policy-binding onagent-prod \
  --member="serviceAccount:340121279179-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
# 3. deploy 時加 --add-cloudsql-instances=onagent-prod:asia-east1:onagent-db
```

每多一個要連線的專案,重複第 2、3 步驟即可,不強制需要組織。
