package main

import (
	"fmt"
	"strings"
)

// seo_meta.go 修正一個 SEO 問題:這個站是純客戶端渲染的 SPA,所有路由
// 共用同一份 web/dist/index.html(見 static.go 的 staticHandler),裡面
// 寫死的 <title>/<meta name="description">/<link rel="canonical"> 等
// 標籤內容全部是首頁的——子頁面(九份/京都/台南安平/赤崁・府城)原本各自
// 透過 react-helmet-async 在 JS 執行後動態改寫,但 Googlebot 第一次抓取
// 頁面、JS 還沒執行的那個瞬間,讀到的 canonical 全部指向首頁——實測確認
// (curl 直接打正式環境,不經過 JS 渲染)這幾個 sitemap.xml 列出的頁面,
// canonical 都錯誤指向 https://tripace.shuttle.tools/。Google 官方文件
// 明確記載:初始 HTML 與渲染後內容的 canonical/title 不一致時,索引結果
// 不保證以渲染後的值為準,很可能造成這些子頁面被當成「canonical 指向
// 首頁的重複內容」而完全不被獨立索引——這很可能是這個網站除了首頁以外
// 的子頁面始終沒有被 Google 搜尋引擎收錄的根因之一。
//
// 2026-10 第二次修正:原本的做法是「server 端修正初始值 + 前端 Helmet
// 繼續動態改寫一次」,但實測(用 Search Console 即時測試工具的 HTML
// 分頁,看 Googlebot 真正渲染後拿到的內容)發現 react-helmet-async
// 不會移除 index.html 裡已經寫死、不是由它插入的標籤,只會在旁邊
// 「追加」一份自己管理的新標籤——導致渲染完成後 <head> 裡同時存在兩個
// <link rel="canonical">(一個指向首頁、一個指向正確頁面),這本身就是
// 一個會讓 Google 直接忽略所有 canonical hint 的錯誤訊號(多個互相矛盾
// 的 canonical 標籤)。改成 server 端輸出的這份內容變成「唯一事實
// 來源」——四個城市介紹頁面的 React 元件已移除 Helmet 裡重複宣告的
// title/description/canonical/og:*/twitter:* 標籤(只保留 structured
// data/JSON-LD,那個 server 端沒有處理,留給前端動態生成),改由這裡
// 的 seoMetaByPath 對照表統一輸出,不再有兩邊各自維護、可能矛盾的風險。
//
// 修法:staticHandler 回傳 index.html 內容前,若目前請求路徑在
// seoMetaByPath 這份對照表裡,用字串取代把首頁的固定內容換成這個路由
// 自己的 title/description/canonical/image——這份對照表的內容必須跟
// 各頁面檔案裡原本 SEO_TITLE/SEO_DESCRIPTION/SEO_URL 常數(現在只用於
// structured data,不再用於這幾個標籤)保持一致,修改其中一邊時記得
// 檢查另一邊。
//
// /privacy、/terms 這兩個 sitemap 裡的路由本身在前端就沒有用 Helmet
// 設定自己的 SEO meta(沿用首頁預設值,是既有且刻意的狀態,不是這次要
// 修的問題範圍),故這份對照表不包含它們。
//
// /product 原本也屬於上述情況,但使用者確認這個頁面的內容(功能介紹)
// 跟首頁不同,canonical 指向首頁會讓 Google 把它當成首頁的重複內容,
// 不會被獨立索引——跟四個城市頁同一類問題,故 2026-10 一併補上。
// /product 沒有自己的代表圖,image 留空字串,表示沿用 defaultImage
// (見 applySEOMeta 對空字串的 fallback 處理)。

type seoMeta struct {
	title       string
	description string
	canonical   string
	image       string
}

var seoMetaByPath = map[string]seoMeta{
	"/jiufen": {
		title:       "九份——礦業興衰與人文重生的山城故事 | Tripace",
		description: "從基隆山的地形限制，到金瓜石礦業的興衰，再到老街、茶樓與海景交錯的人文重生——跟著 Tripace 走一趟九份的散策路線，讀懂這座山城為何長成現在的樣子。",
		canonical:   "https://tripace.shuttle.tools/jiufen",
		image:       "https://storage.googleapis.com/shuttle-tripace-web-assets/landing/jiufen/n0.jpg",
	},
	"/kyoto-kiyomizu": {
		title:       "京都・清水寺——地形、信仰與人文交織的東山散策 | Tripace",
		description: "從清水寺的懸崖地形，到八坂神社的參拜人潮，再到祇園花見小路的茶屋文化——跟著 Tripace 走一趟京都東山的散策路線，讀懂地質、信仰、商業與人文如何層層疊加成這座古都。",
		canonical:   "https://tripace.shuttle.tools/kyoto-kiyomizu",
		image:       "https://storage.googleapis.com/shuttle-tripace-web-assets/landing/kyoto/n1.jpg",
	},
	"/tainan-anping": {
		title:       "台南・安平——荷蘭城堡與老街風土交織的港町故事 | Tripace",
		description: "從熱蘭遮城的築城選址，到運河淤積後老街的重生，再到蜜餞、豆花、冬瓜茶交織的巷弄風土——跟著 Tripace 走一趟台南安平的散策路線，讀懂這座港町為何長成現在的樣子。",
		canonical:   "https://tripace.shuttle.tools/tainan-anping",
		image:       "https://storage.googleapis.com/shuttle-tripace-web-assets/landing/tainan/n1.jpg",
	},
	"/tainan-chikan": {
		title:       "赤崁・府城兩日遊——老地方的前世今生 | Tripace",
		description: "消防塔變史料館、州廳變文學館、老屋變民宿、百貨公司關了又重開——走一趟赤崁樓周邊，看台南這些老地方如何活成現在的樣子，兩天一夜的歷史建築活化路線。",
		canonical:   "https://tripace.shuttle.tools/tainan-chikan",
		image:       "https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan/IMG_9812.webp",
	},
	"/product": {
		title:       "功能介紹——AI編排行程、主題景點、時間軸排程 | Tripace",
		description: "描述你的旅行需求，AI 自動把候選景點排成每日時間軸；點開主題點看周邊精選店家與景點；把候選景點拖進時間軸，一眼掌握整趟旅程的節奏。看看 Tripace 怎麼幫你規劃一趟行程。",
		canonical:   "https://tripace.shuttle.tools/product",
		image:       "",
	},
}

// defaultTitle/defaultDescription/defaultOGTwitterDescription/
// defaultImage:index.html 裡寫死的首頁原始值——applySEOMeta 用它們當
// 「要被取代掉」的鎖定字串,取代完後換成對應路由的值。<meta
// name="description"> 跟 og:description/twitter:description 這兩種
// description 的文字在 index.html 裡本來就不完全相同(og/twitter 版少了
// 開頭「Tripace 幫你」幾個字),故拆成兩個獨立常數,不能共用同一份;
// og:image/twitter:image 則共用同一個 defaultImage(index.html 裡兩者
// 原本就是同一張圖)。這些常數的內容必須跟 index.html 實際內容逐字
// 一致,否則 strings.Replace 找不到比對目標、靜默不生效(不會報錯,只是
// 替換沒發生)——這個風險由下方 checkIndexHTMLHasAllSEOTargets 的健全性
// 檢查緩解(啟動時驗證每個目標字串在 index.html 裡恰好出現一次,找不到
// 就直接 panic 讓部署失敗,不會讓壞掉的版本悄悄上線)。選擇「字串完全
// 比對」而非更複雜的 HTML 解析,是因為 index.html 本身由這個專案自己
// 維護、內容變化可控,用簡單字串取代足夠,不需要引入額外的 HTML parser
// 依賴——但也因此要靠這層檢查補上「這個簡化假設不再成立時務必讓人
// 知道」這一環,不能只靠程式碼審查全靠人眼發現。
const (
	defaultTitle                = "Tripace — 從探索到行程，深入走訪一個想去的地方"
	defaultDescription          = "Tripace 幫你在地圖上探索飯店、景點與餐廳，把喜歡的先丟進候選籃，再拖進日層架排成一趟行程。不只是到過，而是真正讀懂一個地方——與同行的人一起編輯、分享。"
	defaultOGTwitterDescription = "在地圖上探索飯店、景點與餐廳，把喜歡的先丟進候選籃，再拖進日層架排成一趟行程。不只是到過，而是真正讀懂一個地方——與同行的人一起編輯、分享。"
	defaultCanonical            = "https://tripace.shuttle.tools/"
	defaultImage                = "https://tripace.shuttle.tools/og-image.png"
)

// placeholderIndexHTML 是 checked-in 的 web/dist/index.html 在還沒跑過
// 前端 build 時的固定內容(見 static.go 檔頭 webDist embed 的完整說明)
// ——讓沒跑過 vite build 的開發者/CI 也能讓 cmd/server 的 go:embed 成功
// 編譯。2026-10 code review 抓到:原本 static.go/seo_meta_test.go 各自
// 用「是否包含 <title> 字樣」這個弱特徵判斷是不是 placeholder,任何原因
// 導致 indexHTML 讀取/寫入出錯、或未來 placeholder 內容改版新增
// <title>,都會被誤判為「是真正的建置產物」而放行,等於在 fail-closed
// (找不到目標就該 panic/fail)跟 fail-open(誤判成 placeholder 直接
// skip)之間,選了風險更高的後者。改成跟這個固定字串位元組精確比對,
// 不再用啟發式特徵判斷。
const placeholderIndexHTML = "<!doctype html><html><body>build not found</body></html>\n"

// isPlaceholderIndexHTML 判斷 html 是否恰好是 placeholderIndexHTML——
// static.go 的 staticHandler 跟 seo_meta_test.go 的 readRealIndexHTML
// 共用這個函式判斷要不要跳過 SEO meta 的健全性檢查/測試,避免兩邊各自
// 寫一份判斷邏輯、未來改 placeholder 內容時漏改其中一處。比對前用
// strings.TrimSpace 去掉前後空白——checked-in 的 index.html 實際結尾
// 有換行字元(文字編輯器/git 存檔習慣),比對不該因為這類無意義的空白
// 差異就誤判成「不是 placeholder」而誤觸發後續的健全性檢查/測試。
func isPlaceholderIndexHTML(html []byte) bool {
	return strings.TrimSpace(string(html)) == strings.TrimSpace(placeholderIndexHTML)
}

// seoReplaceTargets 回傳 applySEOMeta 這次會嘗試取代的所有目標字串——
// 跟 applySEOMeta 的實際取代邏輯共用同一份清單(見該函式),避免兩邊各自
// 維護一份、容易漏改其中一處。checkIndexHTMLHasAllSEOTargets(見下方)
// 拿這份清單在啟動時驗證 web/dist/index.html 是否每一個都找得到。
func seoReplaceTargets() []string {
	return []string{
		"<title>" + defaultTitle + "</title>",
		`<link rel="canonical" href="` + defaultCanonical + `" />`,
		`<meta
      name="description"
      content="` + defaultDescription + `"
    />`,
		`<meta property="og:url" content="` + defaultCanonical + `" />`,
		`<meta property="og:title" content="` + defaultTitle + `" />`,
		`<meta
      property="og:description"
      content="` + defaultOGTwitterDescription + `"
    />`,
		`<meta property="og:image" content="` + defaultImage + `" />`,
		`<meta name="twitter:title" content="` + defaultTitle + `" />`,
		`<meta
      name="twitter:description"
      content="` + defaultOGTwitterDescription + `"
    />`,
		`<meta name="twitter:image" content="` + defaultImage + `" />`,
	}
}

// checkIndexHTMLHasAllSEOTargets 驗證 index.html 內容裡,
// seoReplaceTargets() 回傳的每個目標字串都恰好出現一次——這是
// applySEOMeta 的字串取代策略(見上方 defaultTitle 等常數的完整說明)
// 唯一的健全性防線:字串比對找不到目標時 strings.Replace 不會報錯,
// 只會靜默跳過,沒有這層檢查的話,index.html 格式只要有任何變動(前端
// 調整 meta 標籤縮排、Vite 版本升級改變輸出格式等),子頁面的 SEO meta
// 取代會悄悄失效,回到這次要修的原始問題(子頁面 canonical 又變回指向
// 首頁),卻不會有任何警訊,只能等重新去 curl 正式環境才會發現。
//
// 呼叫端(staticHandler)在內容看起來不是已知的 placeholder(見
// static.go 的完整說明)時呼叫這個函式,找不到或出現次數不是剛好一次
// 就直接 panic——寧可讓部署在建置/啟動階段就失敗,也不要讓壞掉的 SEO
// meta 悄悄上線、只能靠事後人工發現。
func checkIndexHTMLHasAllSEOTargets(html []byte) error {
	s := string(html)
	for _, target := range seoReplaceTargets() {
		if n := strings.Count(s, target); n != 1 {
			return fmt.Errorf("index.html 裡找不到預期恰好出現一次的 SEO meta 片段(實際出現 %d 次,可能是 index.html 格式已變動,見 seo_meta.go 的完整說明):%q", n, target)
		}
	}
	return nil
}

// applySEOMeta 依請求路徑,把 index.html 內容裡寫死的首頁 title/
// description/canonical/image 取代成該路由自己的值——找不到對應路由
// (不在 seoMetaByPath 裡,例如首頁本身、/privacy、/terms,或任何其餘
// SPA fallback 路由)時原樣傳回,不做任何取代,沿用 index.html 原本的
// 首頁預設內容(這是既有且正確的行為,不是遺漏)。
// 每個目標字串都用 strings.Replace(...,1)(限制取代一次),不是
// ReplaceAll——這份清單裡的字串設計上本來就只該在 index.html 出現
// 一次,限制次數是額外的保險,避免未來不小心在別處重複出現同樣文字時
// 被誤取代。
func applySEOMeta(html []byte, path string) []byte {
	meta, ok := seoMetaByPath[path]
	if !ok {
		return html
	}

	// image 留空字串(例如 /product,見 seoMetaByPath 的完整說明)時沿用
	// defaultImage,不把 og:image/twitter:image 取代成空字串——沒有圖
	// 比沿用首頁的圖更糟(社群分享會完全沒有預覽圖)。
	image := meta.image
	if image == "" {
		image = defaultImage
	}

	s := string(html)

	s = strings.Replace(s, "<title>"+defaultTitle+"</title>", "<title>"+meta.title+"</title>", 1)

	s = strings.Replace(s,
		`<link rel="canonical" href="`+defaultCanonical+`" />`,
		`<link rel="canonical" href="`+meta.canonical+`" />`,
		1)

	s = strings.Replace(s,
		`<meta
      name="description"
      content="`+defaultDescription+`"
    />`,
		`<meta
      name="description"
      content="`+meta.description+`"
    />`,
		1)

	s = strings.Replace(s, `<meta property="og:url" content="`+defaultCanonical+`" />`, `<meta property="og:url" content="`+meta.canonical+`" />`, 1)
	s = strings.Replace(s, `<meta property="og:title" content="`+defaultTitle+`" />`, `<meta property="og:title" content="`+meta.title+`" />`, 1)
	s = strings.Replace(s,
		`<meta
      property="og:description"
      content="`+defaultOGTwitterDescription+`"
    />`,
		`<meta
      property="og:description"
      content="`+meta.description+`"
    />`,
		1)
	s = strings.Replace(s, `<meta property="og:image" content="`+defaultImage+`" />`, `<meta property="og:image" content="`+image+`" />`, 1)

	s = strings.Replace(s, `<meta name="twitter:title" content="`+defaultTitle+`" />`, `<meta name="twitter:title" content="`+meta.title+`" />`, 1)
	s = strings.Replace(s,
		`<meta
      name="twitter:description"
      content="`+defaultOGTwitterDescription+`"
    />`,
		`<meta
      name="twitter:description"
      content="`+meta.description+`"
    />`,
		1)
	s = strings.Replace(s, `<meta name="twitter:image" content="`+defaultImage+`" />`, `<meta name="twitter:image" content="`+image+`" />`, 1)

	return []byte(s)
}
