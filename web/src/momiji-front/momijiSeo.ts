// momijiSeo.ts——紅葉頁的搜尋/分享文案(標題與說明)。
//
// 唯一的「前端這一份」:MomijiFrontPage.tsx 用它產生 <title>、JSON-LD 與給螢幕閱讀器的文字摘要;
// 伺服器端 server/cmd/server/seo_meta.go 的 seoMetaByPath["/momiji-front"] 另有一份(description、
// canonical、og:*、twitter:* 由那邊在 server 端輸出,見 main.tsx 對 HelmetProvider 的說明)。
// 兩邊必須逐字相同,momijiSeo.test.ts 會直接讀 seo_meta.go 比對,改其中一邊忘了另一邊測試會失敗。
//
// 文案風格對齊首頁項目(HomePage.tsx「日本 · 2026 紅葉預測」):攻略式標題;同時保留一句說明
// 「其餘地區為依預測日內插的示意」——來源只有 14 個都市的預測日,其他地方是內插的,不能讓人以為是
// 逐地點的預測。年份與資料檔 momijiForecast.ts 的 FORECAST_YEAR 一致(測試會檢查),換年份時三處一起改。
export const SEO_TITLE = '【2026日本紅葉】賞楓時間預測攻略｜各地見頃日一次看 | Tripace'
export const SEO_DESCRIPTION =
  '【2026日本紅葉】賞楓時間預測攻略！依日本氣象株式會社預測日，從札幌到鹿兒島 14 個主要都市的見頃日一次看，並標出知名賞楓景點，可播放整季楓葉由北往南變色的過程。其餘地區為依預測日內插的示意。'
