import type { SampleItinerary } from '../types'

// 範例行程:清邁深度十日遊。
//
// 2026-10 改版,使用者貼上一份真實的清邁/曼谷行程草稿(12/5~12/12,
// 八天在清邁地區),明確要求「更新現有的 chiangmai-3day 範例」——取代
// 原本的「古城慢活三日」版本,改用這份草稿內容(大象保護園區兩天半、
// 傳統市場、瀑布、南奔一日遊等)。草稿本身還有 12/2~12/4 在曼谷的
// 行程,不屬於「清邁」範例的範圍,這裡不收錄;草稿裡「送機、接機」
// 「民宿玩水」兩項是私人接送/住宿內活動,不是公開景點,不適合放進
// 公開展示的範例行程,同樣省略。
//
// 草稿只標「早/下午/晚」沒有具體時間,这裡依常見的一日行程節奏換算成
// 具體時間值(對齊 types.ts SampleStop.time 的 24 小時制要求,同一天
// 內須遞增)。南奔一日遊是跨區域的一整天行程,只給單一站點(南奔府
// 本身),不展開細項景點——草稿本身也只寫「南奔一日遊」,沒有進一步
// 細節可供拆分。
//
// 2026-10(第二輪,使用者明確提供「12月3日-12月5日 住 Moose Hotel
// Nimman」這筆住宿資訊,並確認「調整 Day 1 起始日期為 12/3」):原本
// Day 1 是 12/5 抵達清邁、直接前往大象保護園區,現在往前擴展兩天,
// 新增 12/3 入住 Moose Hotel Nimman 這一站當作新的 Day 1——原本
// 12/3~12/4 這兩天草稿沒有提供具體活動安排,只標注了住宿,故這裡
// 只加入住資訊本身,不臆測沒有依據的行程內容。原本的 Day 1~8
// (12/5~12/12)整體往後順延兩天,變成新的 Day 3~10,行程總天數從
// 8 天改為 10 天。
//
// 2026-10(第三輪,使用者明確要求「大象保護園拆成住宿跟活動」):原本
// Day 3~5 的「大象保護園區」三站都標記成 kind: '活動'(Day 3 還帶
// duration: '過夜'),沒有獨立的住宿站點,跟 Moose Hotel Nimman/
// MIND Villa 的「住宿/活動分開」處理方式不一致。改成 Day 3、Day 4
// 各自拆成一筆「活動」+一筆「住宿」——大象自然公園本身就提供現場過夜
// 形式(不是另一處獨立的旅館),故住宿站點沿用跟活動站點同一組座標。
// Day 5 上午結束園區行程後直接退房轉往市區(MIND Villa 入住),不需要
// 再加一筆園區住宿站。
//
// 2026-10(第四輪,使用者明確要求「住宿用特別的卡片來表示天數,幫我
// 想一個呈現方式,不要開很多張卡片」「住宿通常是錨點,會有開始結束日」
// 「把樣式跟景點分開」):上一輪把 Moose Hotel Nimman/大象保護園區的
// 住宿各自拆成每晚一筆,導致同一間住宿連住多晚會重複出現好幾張幾乎
// 一樣的卡片。改成每段連續住宿只寫一筆,用新增的 checkOutDay 欄位
// (見 types.ts SampleStop.checkOutDay 的完整說明)表示這筆住宿橫跨
// 到哪一天——Moose Hotel Nimman(原本 Day 1、Day 2 各一筆)合併成
// Day 1 一筆,checkOutDay: 2;大象保護園區住宿(原本 Day 3、Day 4
// 各一筆)合併成 Day 3 一筆,checkOutDay: 4。MIND Villa 只住一晚
// (Day 5),維持單一筆、不帶 checkOutDay(視為只住當天)。渲染端
// (renderItineraryStopCard.tsx)偵測到住宿站會換成專屬的錨點橫幅
// 樣式,不是沿用景點卡版式。
//
// 2026-10(第五輪,使用者明確提供「12月7日-12月9日 住 Hostel One
// Art & Gallery」這筆住宿資訊,並確認「取代 MIND Villa」):查證座標後
// 發現 Hostel One Art & Gallery(18.7832655, 98.9825892)跟原本
// MIND Villa 的座標(18.7837468, 98.9816326)相距不到 100 公尺,都在
// 古城區附近——使用者確認這是同一段住宿安排的正確名稱,取代原本
// Day 5(12/7)入住的 MIND Villa,checkOutDay 設為 7(住到 12/9)。
//
// mapStyle: 'simple'——沿用上一版的既有說明:地圖基底展示版面,簡化版
// Google 地圖樣式,沒有搭配特定主題裝飾。座標全部用
// tripace-cli geocode 查過(-region th):「大象保護園區」統一用「大象
// 自然公園」的座標(草稿本身沒有指名是哪一家保育營,这是清邁最知名、
// 查詢最容易對應到單一 POI 的一家);「湄平河」草稿泛指遊河活動,用
// 湄平河遊船(Mae Ping River Cruise)的碼頭座標代表。
const itinerary: SampleItinerary = {
  id: 'chiangmai-3day',
  title: '清邁深度十日遊',
  region: '泰國・清邁',
  days: 10,
  categories: ['文青', '美食', '自然景觀'],
  summary: '從尼曼區的悠閒落腳，到大象保護園區的三天深度體驗，再到古城市場、瀑布、僧侶步道與南奔一日遊——放慢腳步，走進清邁的日常生活感。',
  addedAt: '2026-10-22',
  mapStyle: 'simple',
  stops: [
    // Day 1(12/3,四)~Day 2(12/4,五)——入住 Moose Hotel Nimman,合併成
    // 一筆,checkOutDay: 2 表示住到 Day 2(見上方第四輪改版說明)。
    { day: 1, time: '15:00', duration: '過夜', name: 'Moose Hotel Nimman', kind: '住宿', desc: '落腳尼曼區,附近就是文青咖啡廳與設計小店聚集的街區', lat: 18.7995128, lng: 98.9667643, checkOutDay: 2 },
    // Day 3(12/5,六)——抵達大象保護園區,下午先參加活動,再入住園區本身
    // (大象自然公園本身提供現場住宿形式,不是另一處獨立的旅館,故住宿
    // 站點沿用同一組座標)。
    { day: 3, time: '14:00', duration: '3h', name: '大象保護園區', kind: '活動', desc: '從清邁市區前往,友善保育形式的大象園區,不騎乘', placeId: 'ChIJj21Ja6g62jARFSuw0w8gLNs', transit: { mode: '開車', minutes: 90, distance: '58km', note: '從清邁市區包車前往,車程約 1.5 小時' }, lat: 19.2171729, lng: 98.8600380 },
    // Day 3-4(12/5~12/6)——園區住宿,合併成一筆,checkOutDay: 4。
    { day: 3, time: '18:00', duration: '過夜', name: '大象保護園區', kind: '住宿', desc: '園區本身提供現場住宿,連住兩晚', placeId: 'ChIJj21Ja6g62jARFSuw0w8gLNs', lat: 19.2171729, lng: 98.8600380, checkOutDay: 4 },
    // Day 4(12/6,日)——整天都在園區。
    { day: 4, time: '09:00', duration: '8h', name: '大象保護園區', kind: '活動', desc: '餵食、洗澡、近距離互動,整天深度體驗', placeId: 'ChIJj21Ja6g62jARFSuw0w8gLNs', lat: 19.2171729, lng: 98.8600380 },
    // Day 5(12/7,一)——上午收尾園區行程,轉往市區入住,下午逛市場,晚上古城漫步。
    { day: 5, time: '09:00', duration: '2h', name: '大象保護園區', kind: '活動', desc: '最後一個上午,結束三天的保護園區行程', placeId: 'ChIJj21Ja6g62jARFSuw0w8gLNs', lat: 19.2171729, lng: 98.8600380 },
    { day: 5, time: '13:00', duration: '1.5h', name: 'Waroros Market', kind: '購物', desc: '清邁最大的傳統市場之一,緊鄰湄平河', placeId: 'ChIJUXF8Lzo72jARQGy1_Bh_wCQ', transit: { mode: '開車', minutes: 80, distance: '58km', note: '園區結束後包車回市區' }, lat: 18.7901454, lng: 99.0007242 },
    { day: 5, time: '15:00', duration: '1.5h', name: 'Muang Mai Market 泰國傳統市場', kind: '景點', desc: '走訪傳統市場,觀察當地居民的日常生活與消費方式,認識泰國常見的水果、蔬菜、香料及在地食材,並與台灣的市場文化及農產品比較', placeId: 'ChIJDy9D4Ls62jARdI3rznLcqEY', lat: 18.7964702, lng: 98.9987861 },
    { day: 5, time: '19:00', duration: '1.5h', name: '古城漫步', kind: '景點', desc: '晚餐後若還有體力,在古城內隨興散步', placeId: 'ChIJdcghNKI62jAR9iY55KuPO50', lat: 18.7878054, lng: 98.9933677 },
    // 入住圖卡放在當天最後(使用者明確要求「入住的圖卡都放在當天最後」)。
    // Day 5-7(12/7~12/9)——Hostel One Art & Gallery,合併成一筆,
    // checkOutDay: 7(見上方第五輪改版說明)。
    { day: 5, time: '20:30', duration: '過夜', name: 'Hostel One Art & Gallery', kind: '住宿', desc: '逛完市場、古城漫步後回來辦理入住,古城區內的藝廊風青旅', lat: 18.7832655, lng: 98.9825892, checkOutDay: 7 },
    // Day 6(12/8,二)——早上瀑布,下午藝術村,晚上再逛一次古城。
    { day: 6, time: '08:00', duration: '3h', name: '卜阿潼瀑布(黏黏瀑布)', kind: '景點', desc: '石灰岩質地特殊,踩在瀑布岩面上不會滑,可以直接攀爬戲水', transit: { mode: '開車', minutes: 80, distance: '62km', note: '建議包車或租車,單程約 1 小時 20 分' }, placeId: 'ChIJu1M68-cb2jARc3Tlb3ICDkw', lat: 19.0694446, lng: 99.079073 },
    { day: 6, time: '14:00', duration: '2h', name: 'Baan Kang Wat', kind: '景點', desc: '藝術村社區,觀察在地藝術家的創作與藝術欣賞', transit: { mode: '開車', minutes: 60, distance: '35km' }, lat: 18.7761906, lng: 98.9483622 },
    { day: 6, time: '19:00', duration: '1.5h', name: '古城漫步', kind: '景點', desc: '晚餐後在古城內隨興散步', placeId: 'ChIJdcghNKI62jAR9iY55KuPO50', lat: 18.7878054, lng: 98.9933677 },
    // Day 7(12/9,三)——下午湄平河遊船,晚上河畔晚餐(避開市區塞車時段)。
    { day: 7, time: '15:00', duration: '2h', name: '湄平河遊河', kind: '景點', desc: '搭船遊湄平河,從水上欣賞清邁市區風光', lat: 18.7806926, lng: 99.0047984 },
    { day: 7, time: '18:00', duration: '1.5h', name: '湄平河畔晚餐', kind: '美食', desc: '提早用餐,避開市區晚間塞車時段', lat: 18.7806926, lng: 99.0047984 },
    // Day 8(12/10,四)——南奔一日遊,跨區域一整天行程。
    { day: 8, time: '09:00', duration: '8h', name: '南奔一日遊', kind: '景點', desc: '清邁南邊的古老府城,孟王朝發源地,步調比清邁市區更悠閒', transit: { mode: '開車', minutes: 40, distance: '25km', note: '建議包車,單程約 40 分' }, lat: 18.5744357, lng: 99.0036972 },
    // Day 9(12/11,五)——早上僧侶步道,下午回民宿,晚上尼曼區。
    { day: 9, time: '08:00', duration: '3h', name: 'Wat Pha Lat 僧侶步道', kind: '景點', desc: '素貼山半山腰的叢林步道,沿途經過瀑布與小寺廟,僧侶日常行走的路線', transit: { mode: '開車', minutes: 45, distance: '26km' }, lat: 18.79632, lng: 98.94347 },
    { day: 9, time: '18:00', duration: '2h', name: '尼曼區漫步', kind: '購物', desc: '文青咖啡廳與設計小店聚集的時髦街區,晚上逛街吃飯', transit: { mode: '公車', minutes: 15, distance: '2.6km', note: '搭雙條車(紅色小巴)' }, placeId: 'ChIJSeLRHWM62jARNbDigb8iLEo', lat: 18.8002767, lng: 98.9676373 },
    // Day 10(12/12,六)——早上文創市集。
    { day: 10, time: '09:00', duration: '2h', name: '真心文創市集', kind: '購物', desc: 'Jing Jai Market,假日限定的文創市集,在地設計小物與有機農產', transit: { mode: '公車', minutes: 15, distance: '3.0km', note: '雙條車或叫車' }, lat: 18.806253, lng: 98.9953026 },
  ],
}

export default itinerary
