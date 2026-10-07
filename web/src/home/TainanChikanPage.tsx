import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ScrollTimeline } from './ScrollTimeline';
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from './SiteNavButtons';
import { CityPageFooter } from './CityPageFooter';
import { ExploreOtherCities } from './ExploreOtherCities';
import { useThemeToggle } from '../hooks/useThemeToggle';
import { trackEvent } from '../analytics';
import { SITE_SEO_BASE_URL } from '../AppCommon';
import './TainanChikanPage.css';

// TainanChikanPage — 赤崁・府城「老地方的前世今生」兩日遊介紹頁,外殼
// 架構對齊 JiufenPage.tsx/KyotoPage.tsx/TainanPage.tsx 模式(互動地圖+
// 進度導覽點+分段長頁+Helmet 管理 title 與 JSON-LD,其餘 SEO meta 見
// 下方 SEO_TITLE/SEO_DESCRIPTION 的完整說明)。2026-10 從內部試做頁
// (/tainan-chikan-draft)轉正成正式路由 /tainan-chikan——敘事主軸的
// 沿革見下方 STOPS 的完整說明(最初是「建築工法×職人技藝」主題構想,
// 後改版成現在的兩日遊遊記)。
// 互動地圖(見下方)已接上真實資料——赤崁樓/祀典武廟/祀典大天后宮/
// 全美戲院/金得春捲/富盛號碗粿/林百貨這 7 個地點已建進 attractions
// 資料庫(2026-09,比照 docs/research-taiwan-attraction-candidates-2026-09.md
// 其餘 12 個主題的既有建檔流程),city="台南" 查回來的資料會跟既有
// TainanPage.tsx(安平老街,主題點:安平古堡)共用同一個城市查詢結果
// ——這是刻意的,兩個主題各自的主題點平等並存於同一張地圖,使用者
// 可以點開任一個看它對應的精選點,不是這個頁面獨占的專屬地圖。
//
// 2026-10 修正:這裡原本寫「地圖主題點錨點用現有資料庫已建檔的
// 『赤崁樓』,因為當時實測確認本機 attractions 資料表台南只有
// 『安平古堡』『赤崁樓』兩個 is_theme,沒有先前設想的『赤崁・府城』
// 這個新主題點名稱」——這段描述已經過時:資料庫後來補建了「赤崁・
// 府城」這個主題點,「赤崁樓」現在降級成它底下的一般精選點(isTheme
// 為 false),不再是主題點本身。defaultOpenTheme="赤崁・府城" 讓這個
// 頁面一進來就先開好這個主題點(對齊 JiufenPage.tsx 單一主題點城市的
// 既有慣例),不預先強制打開安平古堡——傳「赤崁樓」雖然不會報錯,但
// InteractiveExploreMap.tsx 的 defaultOpenTheme 自動開啟邏輯是用
// name 在 themePoints(只含 isTheme 的項目)裡找對應項目,找不到就
// 靜默不開啟任何卡片,使用者進頁面看到的會是沒有主題卡片的空地圖。
//
// SEO_TITLE/SEO_DESCRIPTION/SEO_URL:對齊 JiufenPage.tsx 的既有模式
// (見該檔案同名常數的完整說明——2026-10 修正(兩輪):description/
// canonical/og 與 twitter 系列標籤已改由 server 端 seoMetaByPath 統一
// 輸出;第二輪 code review 抓到 SEO_TITLE/<title> 不該一併移除——
// react-helmet-async 對 title 是直接覆寫 document.title,不會重複/
// 衝突,故保留。SEO_DESCRIPTION/SEO_URL 仍用於下方 JSON-LD)。內容必須
// 跟 seo_meta.go 的 seoMetaByPath["/tainan-chikan"] 保持一致,修改
// 其中一邊記得同步另一邊。
const SEO_TITLE = '赤崁・府城兩日遊——老地方的前世今生 | Tripace'
const SEO_DESCRIPTION = '消防塔變史料館、州廳變文學館、老屋變民宿、百貨公司關了又重開——走一趟赤崁樓周邊，看台南這些老地方如何活成現在的樣子，兩天一夜的歷史建築活化路線。'
const SEO_URL = `${SITE_SEO_BASE_URL}/tainan-chikan`

// PHOTO_TAGGING_PREVIEW_BASE:STOPS 的 gallery 圖片來源——這批照片是
// 2026-09 使用者實地拍攝、透過 tools/img2webp 批次轉檔後上傳到
// gs://shuttle-tripace-photos/review/tainan-chikan/(公開可讀,見該
// bucket 既有的 GCS_PHOTO_BUCKET 用途)。
const PHOTO_TAGGING_PREVIEW_BASE = 'https://storage.googleapis.com/shuttle-tripace-photos/review/tainan-chikan'

// STOPS:2026-10 使用者要求「把這篇遊記的架構直接搬進來」——完整複用
// docs/tainan-chikan-article-draft.html 那篇已發布 artifact 草稿的
// 資料與排版概念(圖文交錯、blurb 部落客語氣文案、資訊框、Day 1/Day 2
// 分段),不是只搬文字塞進舊的單欄小卡片元件。原本 6 站「建築工法/
// 職人技藝」並置敘事(Pexels 示意圖)整個拿掉,改成這 8 站兩日遊內容
// (實地拍攝照片,見 PHOTO_TAGGING_PREVIEW_BASE 的完整說明,來源同一批
// GCS 物件)。
//
// 新增的欄位(相較舊版只有 desc 單段):
// - blurb:部落客語氣的補充短句(可省略),對齊文章版 .blurb 的用途,
//   跟 desc(主要介紹段落)分開渲染,兩者語氣/用途不同不互相取代。
// - gallery:多張照片(取代單一 photo 欄位),每張含 alt/caption,
//   對齊文章版每站可以有 1–3 張圖的彈性。
// - info:資訊框內容(位置/建議停留/備註等 label-value 配對),對齊
//   文章版 .info-box 的呈現方式。2026-10 使用者要求「不用放地址」,
//   把逐站的詳細地址欄位全部拿掉——不需要精確到門牌號碼,「位置」欄位
//   (例如「祀典武廟廟埕旁」)已經夠讓人找到地方。
// - day:1 或 2,渲染時在這一站前面插入「Day 2」分隔線(只在
//   day 從 1 變成 2 的交界處插入一次,不是每站都顯示)。
// - kind:2026-10 使用者要求「主題不用是建築工法」「單純介紹前世今生」
//   ——原本分散的「建築工法/職人技藝」兩種分類全部收斂成統一的
//   「前世今生」標籤,呼應 Hero 的新主軸(消防塔→史料館、州廳→
//   文學館、老屋→民宿、百貨公司關了又重新開張,這批站點共同的敘事
//   角度是「這裡以前是什麼、現在變成什麼」,不是工法/技藝的分類)。
//   天下南隅維持「住宿」——這是功能性標記(標示這站是過夜地點),
//   不是敘事分類,不需要跟著改。index/layout('stacked'/'side' 交替)
//   沿用既有命名。
const STOPS = [
  {
    index: '壱',
    day: 1,
    kind: '前世今生',
    name: '赤崁樓',
    // center:2026-10 新增,見 ScrollTimeline.Anchor 的 center prop 完整
    // 說明——這一站本身就是資料庫裡的主題點(theme="赤崁樓"),理論上不
    // 需要 center 也能正確移動地圖中心(theme 比對優先於 center),這裡
    // 仍然填上是為了讓 8 站的資料形狀一致,不差一站特別省略;真正發揮
    // 作用的是底下其餘 7 站(它們不是主題點,theme 比對不到任何東西,
    // 要靠 center 才能移動地圖)。座標取自本機 attractions 資料庫的
    // 「赤崁樓」記錄。
    center: { lat: 22.997477999999997, lng: 120.2025433 },
    desc: '這裡原本是 1653 年荷蘭人蓋的普羅民遮城，地基是當時的荷式磚造結構。後來清朝人在上面重建了海神廟跟文昌閣，變成現在看到的閩南式閣樓。腳下踩的是荷蘭地基，上面是清代建築，走一圈還滿有意思的。',
    blurb: '兩個完全不同年代的東西疊在一起，逛的時候可以留意一下地基跟上面建築的差別。',
    gallery: [
      { file: 'IMG_9812.webp', alt: '赤崁樓紅牆藍簷迴廊', caption: '紅牆藍簷的迴廊，石柱林立，屋簷雕花清晰可見' },
    ],
    info: [
      ['建議停留', '約 45–60 分鐘'],
      ['備註', '需購票入場，園區內有冷氣展間可稍作休息'],
    ],
    layout: 'stacked',
  },
  {
    index: '弐',
    day: 1,
    kind: '前世今生',
    name: '武廟愛玉',
    // 座標取自資料庫「祀典武廟」記錄(愛玉攤就在廟埕旁,直接沿用該廟
    // 座標,不另外精確到攤位門口)。
    center: { lat: 22.9965989, lng: 120.2021754 },
    desc: '祀典武廟旁邊有一攤手洗愛玉，檸檬味酸酸甜甜的。從赤崁樓走過來剛好，逛完流一身汗，坐下來吃一碗冰涼愛玉很舒服。',
    blurb: '手洗愛玉要把籽洗出膠質才會凝結，看起來簡單其實急不得。',
    // 2026-10 使用者要求「主圖放大,多穿插一點小圖」——這站目前只有
    // PHOTO_TAGGING_CANDIDATES 裡的一張候選(IMG_9813),沒有更多素材
    // 可補,維持單張。見 .tainan-chikan-stop-gallery--single 的樣式
    // (單張圖時走不同的高度規則,不是主圖/小圖版面)。
    gallery: [
      { file: 'IMG_9813.webp', alt: '武廟愛玉店面招牌', caption: '店面招牌清楚寫著「武廟愛玉」，攤位擺著手作商品' },
    ],
    info: [
      ['位置', '祀典武廟廟埕旁'],
      ['建議停留', '約 15 分鐘'],
    ],
    layout: 'side',
  },
  {
    index: '参',
    day: 1,
    kind: '前世今生',
    name: '神農街',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標(非手動猜測)。
    center: { lat: 22.9975171, lng: 120.19649489999999 },
    desc: '這裡以前是五條港時期的商業街，現在改成一間間小店，但木造街屋的樣子還留著。晚上整條街掛滿彩色燈籠，老屋被照得暖暖的，難怪大家都愛來拍照。第一天走到這裡，用這個夜景收尾剛剛好，再往前走幾步就是今晚住的天下南隅。',
    blurb: '假日人潮確實不少，想拍空景幾乎不可能，但這種熱鬧感反而才是神農街的味道。',
    gallery: [
      { file: 'IMG_9817.webp', alt: '神農街夜間燈籠街景', caption: '夜間街景，木造街屋兩側掛滿彩色燈籠' },
      { file: 'IMG_9826.webp', alt: '青花瓷磚老屋外牆', caption: '青花瓷磚裝飾的老屋外牆，門口掛著一排造型燈籠' },
      { file: 'IMG_9823.webp', alt: '轉角店面夜景', caption: '轉角店面夜景，二樓陽台掛著一排燈籠，路人坐在店外休息' },
      { file: 'IMG_9824.webp', alt: '夜間人潮擁擠的街道', caption: '夜間人潮擁擠的街道，兩側店家燈籠與招牌燈火通明' },
    ],
    info: [
      ['建議停留', '約 40–60 分鐘'],
      ['備註', '晚上氣氛最佳，週末人潮較多'],
    ],
    layout: 'stacked',
  },
  {
    index: '肆',
    day: 1,
    kind: '住宿',
    name: '天下南隅',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標(查詢關鍵字「天下南隅 台南」,比對到
    // 「Provintia Hotel 天下南隅」)。
    center: { lat: 22.9993737, lng: 120.203621 },
    desc: '這棟樓 1985 年就開了，以前是台南數一數二的高級商務旅館，據說兩任總統都住過，頂樓那間圓頂西餐廳更是不少台南人的兒時回憶。後來歇業荒廢了好一陣子，2020 年開始整修，花了三年重新設計，2023 年底才以「天下南隅」這個新名字重新開張，把 40 年的老屋氣味留著，又加了點現代感。逛完神農街夜景，剛好可以在這過夜。公共區有個開放式廚房，不是房間裡那種小廚具，可以自己煮點東西；大廳整面書牆配上垂掛的藍白布幔，坐在這裡翻書發呆一下午也不會膩。',
    gallery: [
      { file: 'IMG_9810.webp', alt: '大廳書牆與閱讀區', caption: '大廳書牆與閱讀座位區，天花板垂掛藍白布幔裝置' },
      { file: 'IMG_9809.webp', alt: '公共廚房中島', caption: '公共空間的廚房中島與起居區，冰箱旁立著一把吉他' },
      { file: 'IMG_9811.webp', alt: '大廳圓桌與時鐘', caption: '同一大廳的另一角度，圓桌旁掛著兩座時鐘與圓形畫框' },
    ],
    info: [
      ['位置', '台南市中西區（步行可達神農街）'],
      ['特色', '公共廚房、書牆大廳'],
    ],
    layout: 'stacked',
  },
  {
    index: '伍',
    day: 2,
    kind: '前世今生',
    name: '台南市消防史料館',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標。
    center: { lat: 22.992480999999998, lng: 120.20425849999998 },
    desc: '這棟紅磚建築以前是台南合同廳舍消防塔，在地人習慣叫它「火見樓」，現在改成消防史料館，很適合帶小孩來。裡面有古董手拉幫浦車、復古消防吉普車可以看，還有消防服著裝體驗、滑桿體驗區，小朋友可以實際穿上裝備、背上氧氣瓶道具玩消防員負重體驗、摸摸看真的消防車，不是只能隔著玻璃看展示品。',
    blurb: '這站根本是小孩的主場，光是體驗區就能玩上一陣子，大人也看得很開心。',
    gallery: [
      { file: 'IMG_9833.webp', alt: '消防員模型沿滑桿下滑', caption: '挑高空間裡消防員人形模型正沿著紅色滑桿往下滑' },
      { file: 'IMG_9838.webp', alt: '消防服著裝承重體驗', caption: '「消防服著裝承重體驗」展示區，掛著實際消防衣與安全帽' },
      { file: 'IMG_9839.webp', alt: '兒童體驗區消防員負重體驗', caption: '兒童體驗區，小朋友背著氧氣瓶道具進行消防員負重體驗' },
      { file: 'IMG_9831.webp', alt: '復古消防吉普車', caption: '館內陳列的復古紅色消防吉普車，車身保存完整' },
      { file: 'IMG_9843.webp', alt: '消防塔近景', caption: '消防塔（火見樓）近景，旁邊道路上停著消防車' },
      { file: 'IMG_9828.webp', alt: '建築構造展板', caption: '建築構造展板，標示「火見樓」「旗杆」等建築部位名稱' },
      { file: 'IMG_9864.webp', alt: '消防塔夜景', caption: '夜景，消防塔樓體打上暖黃燈光' },
    ],
    info: [
      ['建議停留', '約 30–40 分鐘'],
      ['備註', '免費參觀，設有兒童消防體驗區'],
    ],
    layout: 'stacked',
  },
  {
    index: '陸',
    day: 2,
    kind: '前世今生',
    name: '國立臺灣文學館',
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標。
    center: { lat: 22.9918527, lng: 120.2044791 },
    desc: '這裡以前是台南州廳，老建築的紅磚拱廊整個保留下來，後面又加蓋了一個現代化的圓弧量體，新舊兩種建築語彙就這樣接在一起，走進中庭會先看到老牆、再看到玻璃天花板採光罩，反差感很明顯但不違和。館內有台灣文學發展的常設展，免費參觀，天氣太熱的時候很適合躲進來吹冷氣順便看展。',
    blurb: '紅磚拱廊配現代採光罩這種新舊混搭，比起單純看老建築或單純看新建築，反而更好拍。',
    gallery: [
      { file: 'IMG_9848.webp', alt: '新舊建築交界的長廊', caption: '長廊空間，紅磚拱門與現代化天花板採光罩並存' },
      { file: 'IMG_9845.webp', alt: '挑高中庭新舊並存', caption: '挑高中庭，紅磚拱廊與現代圓弧量體建築並存' },
      { file: 'IMG_9849.webp', alt: '文學館紅磚立面', caption: '建築外觀，紅磚立面搭配拱窗，門前種植高聳的棕櫚樹' },
      { file: 'IMG_9846.webp', alt: '室內紅磚牆面與閱讀區', caption: '室內紅磚牆面與白色圓柱，旁邊擺著兒童繪本閱讀區' },
      { file: 'IMG_9852.webp', alt: '州廳建築模型', caption: '館內陳列的建築模型，還原原台南州廳的紅磚屋頂全貌' },
    ],
    info: [
      ['建議停留', '約 30–45 分鐘'],
      ['備註', '免費參觀，週一休館'],
    ],
    layout: 'side',
  },
  {
    index: '柒',
    day: 2,
    kind: '前世今生',
    name: '林百貨',
    // 座標取自資料庫「林百貨」記錄。
    center: { lat: 22.9917925, lng: 120.2025232 },
    desc: '1932 年開幕，是台南第一間百貨公司，戰後荒廢了幾十年，2014 年才整修重新開幕。轉角立面跟排列整齊的圓窗還是當年的樣子，頂樓還留著神社遺跡。逛完文學館過來剛好，可以上頂樓露台吹吹風、隨意逛逛買點東西，順便吃碗豆花。',
    blurb: '頂樓露台掛滿裝飾燈串，坐在騎樓下休息，看得到旁邊街道，逛到一半需要喘口氣的話很適合。',
    gallery: [
      { file: 'IMG_9854.webp', alt: '林百貨轉角外觀', caption: '轉角建築外觀，裝飾藝術風格立面、圓窗排列整齊' },
      { file: 'IMG_9855.webp', alt: '頂樓露台裝飾燈串', caption: '頂樓露台，掛滿裝飾燈串，遊客在騎樓下的座位區休憩' },
      { file: 'IMG_9856.webp', alt: '山海豆花', caption: '頂樓山海豆花——粉圓、豆類與碎冰的組合' },
    ],
    info: [
      ['建議停留', '約 45 分鐘（含頂樓豆花）'],
      ['備註', '頂樓設有神社遺跡，營業時間詳見官方公告'],
    ],
    layout: 'side',
  },
  {
    index: '捌',
    day: 2,
    kind: '前世今生',
    name: '台南孔廟・孔廟商圈',
    // 2026-10 使用者要求「孔廟與孔廟商圈放一起」——原本是兩個獨立站點
    // (孔廟本體/周邊商圈),合併成一站,文案先講孔廟本體、再帶到周邊
    // 商圈,理由是商圈本來就是孔廟外圍的延伸,動線上也是同一次停留,
    // 沒有必要拆成兩個卡片。gallery 合併原本兩站的照片(孔廟本體 4 張
    // + 商圈 2 張),info 合併成單一資訊框。
    // 不在 attractions 資料庫裡,座標是用 CLI geocode 工具查 Google
    // Places 拿到的真實座標(查詢關鍵字「台南孔廟」)。
    center: { lat: 22.9905296, lng: 120.2040401 },
    desc: '紅牆大門上掛著「全臺首學」的匾額，1665 年就建了，是全台第一座孔廟。院落裡老樹枝葉很茂密，泮池的水面會倒映出對面建築的屋脊，傍晚去特別安靜。孔廟外圍這一帶是台南人熟悉的商圈，石造牌坊是入口地標，從林百貨走過來不遠，氣氛介於觀光跟日常之間。',
    blurb: '原本想排海安路，但那天週一多數店休，改來孔廟商圈這一帶逛——牌坊進去也有不少小店，氣氛差不多。',
    gallery: [
      { file: 'IMG_9857.webp', alt: '全臺首學匾額', caption: '紅牆大門，匾額清楚寫著「全臺首學」' },
      { file: 'IMG_9862.webp', alt: '泮池水景', caption: '泮池水景，倒映著對岸紅牆建築的屋脊剪影' },
      { file: 'IMG_9859.webp', alt: '院落景觀', caption: '院落景觀，紅牆廟宇建築掩映在老樹枝葉之間' },
      { file: 'IMG_9860.webp', alt: '傍晚院落與草坪', caption: '傍晚院落，老樹樹冠下可見紅牆廟宇建築群與草坪' },
      { file: 'IMG_9858.webp', alt: '孔廟商圈石造牌坊', caption: '石造牌坊入口，通往傍晚燈火漸亮的商店街道' },
      { file: 'IMG_9863.webp', alt: '石造牌坊近景', caption: '石造牌坊近景，傍晚時分，牌坊後方隱約可見紅牆建築' },
    ],
    info: [
      ['建議停留', '約 1 小時（含孔廟與周邊商圈）'],
      ['備註', '孔廟免費參觀，傍晚光線最適合拍照'],
    ],
    layout: 'side',
  },
] as const;

export function TainanChikanPage() {
  const { theme, dark, toggleTheme } = useThemeToggle();

  return (
    <div className="tainan-chikan-page" data-theme={theme ?? undefined}>
      <Helmet>
        {/* <title> 保留在這裡——react-helmet-async 對 title 是直接覆寫
            document.title,單一值覆寫不會重複/衝突,SPA 內部換頁時仍
            需要它才能正確更新分頁標題。description/canonical/og 與
            twitter 系列標籤則已移除——那些是用 DOM insert 新節點、不會
            移除 index.html 原有的靜態標籤,兩份並存會互相矛盾(見上方
            SEO_TITLE/SEO_DESCRIPTION 常數的完整說明),改由
            server/cmd/server/seo_meta.go 的 seoMetaByPath 統一輸出。
            og:type/twitter:card 這兩個固定值(不隨頁面變化)本來就跟
            index.html 的首頁預設值相同,直接沿用、不需要個別頁面覆寫。
            JSON-LD 結構化資料——對齊 JiufenPage.tsx 的既有模式(見該檔案
            對應區塊的完整說明),純粹是曝光/點閱率的加分項,不影響頁面
            本身的渲染或排序邏輯。 */}
        <title>{SEO_TITLE}</title>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TouristDestination',
            name: '赤崁・府城',
            description: SEO_DESCRIPTION,
            url: SEO_URL,
            image: `${PHOTO_TAGGING_PREVIEW_BASE}/IMG_9812.webp`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: '中西區',
              addressRegion: '台南市',
              addressCountry: 'TW',
            },
            containsPlace: STOPS.map((s) => ({
              '@type': 'TouristAttraction',
              name: s.name,
              description: s.desc,
            })),
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Tripace', item: `${SITE_SEO_BASE_URL}/` },
              { '@type': 'ListItem', position: 2, name: '赤崁・府城', item: SEO_URL },
            ],
          })}
        </script>
      </Helmet>
      {/* 2026-09:使用者要求「主題介紹頁的右上按鈕」跟首頁對齊大小,回報
          「怎麼都沒改」後發現這四個城市頁原本各自維護一份獨立樣式,
          完全沒有跟 HomePage.tsx/ProductPage.tsx 共用的 SiteNavButtons
          對齊,這裡一併改用同一份共用元件(見 SiteNavButtons.tsx/
          JiufenPage.tsx 的完整說明)。 */}
      <SiteNavBrand pageLabel="赤崁・府城" />
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'tainan-chikan', position: 'nav' })}>立即開始</SiteNavCta>

      {/* 2026-10:使用者要求「把遊記架構直接搬進來」——Hero 文案換成兩日遊
          遊記版本(對齊 docs/tainan-chikan-article-draft.html 的
          .hero-eyebrow/h1/hero-lede/hero-meta 結構),不再是「六種工法」
          的抽象主題介紹,改成具體的兩日遊行程說明。
          2026-10 再次調整:使用者要求「主題不用是建築工法」「單純介紹
          前世今生」——不再用「活化」「工法」這類專業術語當主軸,改成
          最直接的敘事角度:這裡以前是什麼、現在變成什麼。消防塔變
          消防史料館、州廳變文學館、老屋變民宿、百貨公司關了又重新
          開張,每一站都在講這個簡單的轉折,搭配武廟愛玉/林百貨豆花/
          神農街夜色的美食與街景。 */}
      <header className="tainan-chikan-hero">
        <span className="tainan-chikan-hero-eyebrow">台南兩日遊 · 老地方的前世今生</span>
        <h1>赤崁・府城兩日遊<br />歷史建築活化・住宿・景點・美食</h1>
        <p>
          這趟在赤崁樓附近走了兩天，發現很多地方以前都不是現在這個樣子：
          消防塔改成了消防史料館，州廳變成文學館，一間老屋改成了民宿。
          中間還吃了武廟愛玉、在林百貨採買了一下，晚上去神農街看了燈籠。
          整理成這篇，給想走同一條路線的人參考。
        </p>
      </header>

      <div className="tainan-chikan-route-strip">
        <span className="tainan-chikan-route-label">Day 1：赤崁樓 → 武廟愛玉 → 神農街 → 天下南隅（入住）</span>
        赤崁樓 <span className="tainan-chikan-route-arrow">→</span> 武廟愛玉 <span className="tainan-chikan-route-arrow">→</span> 神農街 <span className="tainan-chikan-route-arrow">→</span> 天下南隅
      </div>
      <div className="tainan-chikan-route-strip tainan-chikan-route-strip--day2">
        <span className="tainan-chikan-route-label">Day 2：消防史料館 → 文學館 → 林百貨 → 台南孔廟・孔廟商圈</span>
        消防史料館 <span className="tainan-chikan-route-arrow">→</span> 文學館 <span className="tainan-chikan-route-arrow">→</span> 林百貨 <span className="tainan-chikan-route-arrow">→</span> 台南孔廟・孔廟商圈
      </div>

      {/* 2026-10 試做:套用 ScrollTimeline(見該元件開頭的完整說明)取代
          原本「獨立進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自
          獨立的結構——改成左側時間軸縮圖 + 右側可展開的嵌入式小地圖,
          隨捲動同步移動,文案本身完全不變(圖文交錯站點卡/blurb/
          gallery/info-box 全部原樣保留,只是外層從 <section> 換成
          <ScrollTimeline>,每一站從純 <article> 包一層
          <ScrollTimeline.Anchor>)。useScrollProgress/mapIntroRef/
          stopRefs/MobileMapReveal 這整套捲動追蹤+地圖顯示機制因此不再
          需要,已從檔案開頭的 import 移除。
          theme 只在 stop.name 是「赤崁樓」那一站才填——這個 worktree
          本機資料庫目前查到的台南主題點(isTheme=true)是「赤崁樓」,不是
          檔案開頭沿革註解提到的「赤崁・府城」(本機這份本地 Postgres 的
          seed 資料跟那段註解描述的遷移後狀態對不上,推測是不同資料庫
          實例/未套用同一批遷移,之後要正式套用到部署環境記得重新核對
          實際主題點名稱)。其餘 7 站都不是資料庫裡的主題點(甚至 5 站
          根本不在資料庫裡),theme 比對不到東西,改用 center(見
          ScrollTimeline.tsx 的 center prop 完整說明)直接指定座標——
          已在資料庫的 3 站(赤崁樓/武廟愛玉/林百貨)座標取自 attractions
          資料庫記錄,不在資料庫的 5 站(神農街/天下南隅/消防史料館/
          文學館/孔廟)座標是用 CLI geocode 工具實際查 Google Places
          拿到的真實座標(每一站 STOPS 項目旁都有各自的座標來源註解),
          不是憑印象猜的。
          thumb 用每一站 gallery 的第一張照片,跟原本 MobileMapReveal
          只取 STOPS[0] 第一張圖的既有慣例一致,只是現在每一站都各自
          有自己的縮圖(而非只有進入地圖區塊前那一張)。 */}
      <div className="tainan-chikan-stops">
      <ScrollTimeline city="台南" defaultOpenTheme="赤崁樓">
        {STOPS.map((stop, i) => {
          const prevDay = i > 0 ? STOPS[i - 1].day : stop.day
          const showDayDivider = i > 0 && stop.day !== prevDay
          return (
            <div key={stop.name}>
              {showDayDivider && (
                <div className="tainan-chikan-day-divider">
                  <div className="tainan-chikan-day-divider-line" />
                  <span>Day {stop.day}</span>
                  <div className="tainan-chikan-day-divider-line" />
                </div>
              )}
              <ScrollTimeline.Anchor
                id={stop.name}
                thumb={`${PHOTO_TAGGING_PREVIEW_BASE}/${stop.gallery[0].file}`}
                theme={stop.name === '赤崁樓' ? '赤崁樓' : undefined}
                center={stop.center}
                label={stop.name}
              >
                <article className="tainan-chikan-stop">
                  <div className="tainan-chikan-stop-head">
                    <span className="tainan-chikan-stop-index">{stop.index}</span>
                    <h2>{stop.name}</h2>
                  </div>
                  <p className="tainan-chikan-stop-body">{stop.desc}</p>
                  {'blurb' in stop && stop.blurb && (
                    <p className="tainan-chikan-stop-blurb">{stop.blurb}</p>
                  )}
                  <div className={`tainan-chikan-stop-gallery${stop.gallery.length === 1 ? ' tainan-chikan-stop-gallery--single' : ''}`}>
                    {stop.gallery.map((photo) => (
                      <figure key={photo.file}>
                        <img
                          src={`${PHOTO_TAGGING_PREVIEW_BASE}/${photo.file}`}
                          alt={photo.alt}
                          loading="lazy"
                        />
                        <figcaption>{photo.caption}</figcaption>
                      </figure>
                    ))}
                  </div>
                  <dl className="tainan-chikan-info-box">
                    {stop.info.map(([label, value]) => (
                      <div className="tainan-chikan-info-row" key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              </ScrollTimeline.Anchor>
            </div>
          )
        })}
      </ScrollTimeline>
      </div>

      <section className="tainan-chikan-final-cta">
        <h2>把赤崁・府城的行程，排進你的下一趟旅行</h2>
        <p>在 Tripace 上探索景點、拖曳排入日程，規劃一趟屬於自己的台南兩日遊。</p>
        <Link
          to="/app"
          className="tainan-chikan-btn-primary"
          onClick={() => trackEvent('landing_cta_click', { page: 'tainan-chikan', position: 'final' })}
        >
          開始使用
        </Link>
      </section>

      <ExploreOtherCities currentSlug="tainan-chikan" />

      <CityPageFooter />
    </div>
  );
}
