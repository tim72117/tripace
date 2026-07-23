package main

// trainExample 是一筆訓練資料:輸入一句可能出現在行程記事裡的一句話,
// 標註正確的地點處理分類。BootstrapFewShot 會從這些範例裡挑選最有
// 代表性的幾筆,組成 few-shot demonstrations 插入最終的 prompt——這就是
// 「optimizer 產生 prompt」的實際產出:不是憑空生成一段新指令文字,而是
// 自動選出最能幫助 LLM 做對這個任務的範例組合。
type trainExample struct {
	text   string
	action string // "geocode" | "ask_recommend" | "none"
}

// trainSet 刻意選得少而精,涵蓋三類與一些容易混淆的邊界情況——例如
// 「京都」是區域(ask_recommend),但「京都車站」是可定位的單一地點
// (geocode);「開會」完全沒有地點資訊(none)。
//
// 這次優化的明確目標:「我要去台中」這種只有地名+意圖動詞、完全沒有
// 期程/飯店/景點描述的最簡短句型,必須正確分類成 ask_recommend(該問
// 使用者要不要推薦附近景點)。這類句型跟「這次去京都玩三天」「預計在
// 北海道待一週」等帶期程描述的版本比,線索少很多(只剩地名本身),
// 容易被誤判——刻意放進多筆同構的簡短案例(不同縣市),讓 MIPRO 搜尋
// instruction 候選時有足夠訊號聚焦在這個模式上。
var trainSet = []trainExample{
	{"明天住宮古島希爾頓酒店", "geocode"},
	{"7/1 去東京晴空塔", "geocode"},
	{"訂築地場外市場旁邊那間迴轉壽司", "geocode"},
	{"下週一到成田機場", "geocode"},

	{"這次去京都玩三天", "ask_recommend"},
	{"預計在北海道待一週", "ask_recommend"},
	{"去沖繩的行程還沒排", "ask_recommend"},
	{"我要去台中", "ask_recommend"},
	{"下個月去高雄", "ask_recommend"},
	{"我要去台北", "ask_recommend"},
	{"這次去花蓮", "ask_recommend"},

	{"明天下午三點跟客戶開會", "none"},
	{"提醒我明天早上八點吃藥", "none"},
	{"這週有什麼安排", "none"},
	{"謝謝你的幫忙", "none"},
}

// evalSet 是跟訓練集分開的評估資料,用來驗證 optimizer 產生的 prompt
// 是否真的有效——不能拿訓練集自己評自己,那樣看不出優化後的 prompt
// 有沒有真的幫助 LLM 泛化到沒看過的句子。「我要去台南」「這次去台東」
// 刻意不跟 trainSet 裡的任何一筆重複(縣市不同),直接對應這次優化的
// 目標:驗證「我要去 X」這個最簡短句型本身有沒有被真正學到,而不是背
// 特定縣市名稱的答案。
var evalSet = []trainExample{
	{"後天住大阪環球影城旁的飯店", "geocode"},
	{"這趟九州行大概安排五天", "ask_recommend"},
	{"下午兩點的會議改到三點", "none"},
	{"我要去台南", "ask_recommend"},
	{"這次去台東", "ask_recommend"},
}
