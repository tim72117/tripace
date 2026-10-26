// seo.ts——/island 頁的搜尋/分享文案(標題與說明)。
//
// 前端這一份用來產生 <title> 與給爬蟲讀的文字摘要;伺服器端 server/cmd/server/seo_meta.go 的
// seoMetaByPath["/island"] 另有一份(description、canonical、og:*、twitter:* 由那邊在 server 端輸出)。
// 兩邊必須逐字相同(含標點),seo.test.ts 會直接讀 seo_meta.go 比對,改其中一邊忘了另一邊測試會失敗。
export const SEO_TITLE = '夜遊九份島——把一篇遊記變成一座會亮燈的島 | Tripace'
export const SEO_DESCRIPTION =
  '傍晚上山，看九份的紅燈籠沿著石階一盞一盞亮起。這是依據部落客遊記〈夜遊九份〉做成的低多邊形小島，可以旋轉、拖動時間、逐站閱讀，並下載附署名的分享圖。'
