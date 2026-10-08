// AccentColorProp——2026-10 新增,三個共用元件(CityPageFooter/
// ExploreOtherCities/ScrollTimeline)都需要呼叫端提供一個強調色,原本
// 各自獨立定義結構相同的 accentColor: string 必填 prop 與幾乎一字不差
// 的說明註解(code review 抓到的重複)。抽成這個共用型別,三處都
// `accentColor: AccentColorProp` 引用同一份,說明文件只維護一份,行為
// 不變(型別本質仍是 string,只是有名字、有一處集中的文件)。
//
// 為什麼改成必填 TypeScript prop(而非原本「呼叫端 CSS 自行定義
// --footer-accent/--explore-accent/--timeline-accent 同名變數」的
// 隱性約定):CSS 的 var() 找不到變數時不會報錯,只會安靜 fallback 成
// initial,這個隱性契約在套用 ScrollTimeline 到九份/京都頁時被漏寫
// 過,肉眼比對了好幾輪才抓到地圖面板邊框顏色不對;TainanPage.css 甚至
// 從未真正定義過 --footer-accent(只有說明用的註解,沒有賦值),這個
// bug 更隱蔽、更早發生、從未被注意到過。改成必填 prop 後,呼叫端忘記
// 傳會是編譯期錯誤。
// 用法:呼叫端通常傳 "var(--vermilion)" 或 "var(--brick)" 這類 CSS
// 變數參照字串(維持跟著 data-theme/系統偏好切換的彈性),也可以直接
// 傳色碼字串,型別不限制格式。
export type AccentColorProp = string
