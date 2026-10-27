import { Link } from 'react-router-dom'
import { getCategory } from './categories'
import styles from './HandbookIndex.module.css'

// HandbookIndex:產品方向腦力激盪(/ideas/product-direction-*,原 docs/brainstorm 文件已改寫成構想頁)
// 六項產品構想的雛形試做入口頁——使用者要求「開始試做雛形，有可以延續的
// 就延續製作」「直接試做」「你全權處理試做，不用問細節」,這裡是統一的
// 導覽入口,不對外公開(不在首頁/導覽列任何地方連結),只能直接輸入網址
// /handbook 進入,純供內部查看雛形用。
//
// 每個構想對應一個子路由,各自是獨立元件、互不依賴——這裡只負責列出
// 清單跟簡短說明,實際雛形內容在各自的檔案裡。
// priority——2026-10 新增,使用者明確要求「用星等標示優先序」,後續
// 再要求「優先序用三顆星就好,用黃色系」:滿分 3 顆星(原本試過 1~5
// 分,使用者明確要求簡化)。使用者直接拍板「1 2 5 最優先,6 為次,其他
// 先不評等」——這不是從說服力/整合成本/商業急迫性這類面向推導出來的
// 分數,是使用者直接決定的順序,故只有構想一/二/五/六的註解在補充
// 「為什麼這個順序合理」,其餘構想(三、四、七、八、九~二十一)統一
// 給 1 星,不再逐項評估細緻層級——使用者明確要求「其他先不評等」,
// 代表除了明確拍板的這四個構想,其餘暫時不花心力排相對順序,留到真正
// 要往下發展時再個別重新評估。附錄/延伸補充項目(例如構想一附錄、
// 構想六附錄)沿用其主構想的星等,不獨立評分——它們是同一個決策底下
// 的不同呈現形式,不是各自獨立要不要做的問題。
//   3 星 = 構想一/二/五(使用者明確拍板最優先)
//   2 星 = 構想六(使用者明確拍板次優先)
//   1 星 = 其餘所有構想(三、四、七、八、九~二十一,暫不評等)
type Priority = 1 | 2 | 3

const ITEMS: {
  path: string
  title: string
  status: 'ready' | 'draft'
  priority: Priority
  desc: string
  // indent——2026-10 新增,專給構想六附錄A/B 使用:標記這個項目是上一個
  // 項目的附錄/子項目,渲染時套用 styles.itemIndented(縮排 + 左側引導
  // 線,見該 class 的完整說明),表達「同一個決策底下的不同呈現形式」
  // 這種從屬關係。刻意不套用到構想一的附錄一~四(那組維持原本「標題
  // 字首寫『構想一附錄：』」的既有表達方式,不互相依賴同一套機制)
  // ——廣告投放相關的改動(構想六)與其他構想的改動保持獨立,不為了
  // 避免重複而讓兩者共用同一個欄位。
  indent?: boolean
}[] = [
  // 構想一——5 星:核心轉換漏斗(訪客→相信 AI 真的能排行程→願意登入
  // 使用),且已有完整雛形驗證可行,複用成本低(ItineraryShowcasePage 本身
  // 已經是接近完成品的雛形)。
  {
    path: '/itinerary-showcase',
    title: '構想一：AI 排過的主題行程展示',
    status: 'ready',
    priority: 3,
    desc: '卡片牆 + 分類篩選 + 唯讀時間軸預覽彈窗，純前端假資料。另見下方「構想一附錄」——地圖基底的瀏覽方式延伸雛形。',
  },
  // 構想一附錄——2026-10 新增:比照構想六/「構想六附錄：投放設定介面
  // 範例」的既有先例(主構想 + 附錄互動雛形的分法)。這個地圖基底雛形
  // 原本探索的脈絡來自構想七(路徑機制)的文案構想稿,但使用者明確
  // 指出「地圖基底的介面設計」本質上是構想一(行程展示呈現方式)的
  // 一種延伸呈現方式,不是構想七路徑機制的附屬——瀏覽一份已經排好的
  // 主題行程時,除了構想一原本的卡片牆,也可以選擇用地圖為版面骨架的
  // 方式瀏覽,因此歸屬調整放在構想一底下。status 標 'ready'——這是真的
  // 做出互動雛形,不是文案構想稿。
  {
    path: '/route-path-map-skeleton',
    title: '構想一附錄：地圖基底介面骨架雛形',
    status: 'ready',
    priority: 3,
    desc: '瀏覽一份主題行程時，改用地圖為版面骨架的呈現方式——路徑線沿畫面斜切而過，沿線的圓形縮圖徽章點擊展開站點卡片。重點在地圖畫布/路徑線/縮圖徽章的排版與互動細節；卡片內容只是簡化示意，不是本雛形重點。花東縱谷沿線假資料。',
  },
  // 構想一附錄二——2026-10 新增:使用者分享一張圖文整合的旅遊攻略
  // 截圖(插畫地圖+編號路線+城市色卡),指出重點是「CLI 可以加入圖卡、
  // 標註、路線、時間軸....不同的呈現方式」。跟構想一附錄(地圖為主要
  // 互動介面,逐站點開看細節)不同,這裡是「整頁總覽式懶人包,滾動
  // 瀏覽即可看完全部內容」,兩者互補,不是互相取代——見
  // ItineraryPosterPage.tsx 檔頭的完整歸屬說明。priority 沿用構想一
  // 的星等,理由同構想一附錄。
  {
    path: '/itinerary-poster',
    title: '構想一附錄二：版面化行程懶人包',
    status: 'ready',
    priority: 3,
    desc: '把一份行程組成整頁可滾動瀏覽的懶人包版面——用區塊化資料結構示範 route-map（路線縮圖）/ stop-card（城市色卡）/ timeline-day（單日時間軸）/ callout（收尾強調句）四種區塊，呼應部落格 content_pages 的 blocks 扁平陣列機制。台灣西部五城假資料。',
  },
  // 構想一附錄三——2026-10 新增:使用者提出「時間軸做成大富翁，地圖
  // 中間，外圈掛上時間軸」的構想:瀏覽一份已排好的行程時，把地圖放在
  // 畫面正中央當棋盤的「內盤」，行程站點依序排成棋盤外圈的方格，像走
  // 大富翁一樣一格一格繞一圈，呼應「依序走過的站點」這個行程本質。跟
  // 構想一附錄(地圖為主要互動介面，路徑線斜切過畫面)、構想一附錄二
  // (整頁總覽式懶人包)是同一份行程資料的第三種瀏覽骨架——附錄聚焦
  // 「地圖本身的互動」，附錄二聚焦「一次滾動看完全部」，這裡聚焦「棋盤
  // 繞圈的站點順序感」，三者互補，不是互相取代。priority 沿用構想一的
  // 星等，理由同構想一附錄/附錄二。
  {
    path: '/itinerary-monopoly',
    title: '構想一附錄三：大富翁棋盤時間軸',
    status: 'ready',
    priority: 3,
    desc: '把地圖放在畫面正中央當棋盤「內盤」，行程站點依序排成棋盤外圈方格，像走大富翁一樣一格一格繞一圈——呼應「依序走過的站點」這個行程本質。跟構想一附錄(地圖互動為主)、附錄二(整頁懶人包)是同一份行程資料的不同瀏覽骨架，這裡聚焦棋盤繞圈的站點順序感。九份一日散策假資料。',
  },
  // 構想一附錄四——2026-10 新增:正式功能 AiItineraryDetailPageMapView.tsx
  // (地圖全幅背景 + 左美食面板 + 右時間軸面板)最近做了一輪局部活潑化
  // (手繪貼紙卡片、古城風格地圖邊框),使用者進一步想看「整體版面構圖
  // 本身」能不能更活潑,不被「左地圖右面板」侷限。這份雛形的隱喻是
  // 「攤開的旅行手帳」:左頁手繪尋寶地圖、右頁貼拍立得的日記頁、頁緣
  // Day 索引耳翻頁、下緣護照戳章當進度列——地圖跟時間軸是平起平坐的
  // 兩頁,不是「地圖當背景、面板浮在上面」。跟附錄/附錄二/附錄三一樣
  // 是同一份行程的另一種瀏覽骨架。priority 沿用構想一的星等。
  {
    path: '/itinerary-playful-map',
    title: '構想一附錄四：尋寶手帳攤開頁',
    status: 'ready',
    priority: 3,
    desc: '整個畫面是一本攤開的旅行手帳：左頁手繪尋寶地圖（虛線步徑會流動、水滴圖釘貼紙、目前站腳下畫 X 藏寶標記），右頁橫線筆記紙上貼歪斜的拍立得（和紙膠帶 + 橡皮章時間戳）與夾頁收據式美食口袋名單，頁緣 Day 索引耳翻天，下緣一排護照戳章標示走到第幾站。地圖/拍立得/戳章三處點擊同步高亮。台南赤崁・府城兩日遊假資料。',
  },
  // 構想二——5 星(使用者明確拍板最優先):手機版是多數訪客的第一印象
  // 載體,按鈕熱區/bottom sheet 手感直接影響「這個產品可不可靠」的第一
  // 判斷,這次 session 也已經完成重構,複用成本等同零——優先序本身不是
  // 靠延伸功能帶動營收,而是最基本的體驗門檻,排進最優先順位合理。
  {
    path: '/component-conventions',
    title: '構想二：手機版介面優化（元件庫文件化）',
    status: 'ready',
    priority: 3,
    desc: '這次 session 已完成 bottom sheet 體系重構，這裡整理成一份內部設計規範速覽。',
  },
  // 構想三——4 星:直接影響 AI 排出來的行程「準不準、像不像真人安排」,
  // 是產品核心能力的一環,且已有雛形驗證兩種呈現模式都可行,複用今天
  // 完成的主題點/children 概念整合成本低。
  {
    path: '/planning-modes',
    title: '構想三：依地點特性分化規劃模式',
    status: 'ready',
    priority: 1,
    desc: '九份型（亮點地圖）vs 赤崁型（時間軸列表）兩種呈現方式並排對照，同一份假資料套用兩種模式。',
  },
  // 構想四——3 星:提升使用者對已排行程的信任感(避免排出不合理的行程),
  // 價值明確但不是說服新訪客的關鍵因素,複雜度中等(需要營業時間/交通
  // 資料源支援)。
  {
    path: '/itinerary-checkup',
    title: '構想四：行程健檢',
    status: 'ready',
    priority: 1,
    desc: '假時間軸資料跑過健檢規則（時間衝突/交通銜接/營業時間/餐期），列出警示卡片。',
  },
  // 構想五——5 星(使用者明確拍板最優先):使用者自己明確表示過「先從
  // 這裡開始做」(見 PostComposerPage.tsx 檔頭說明),且能直接銜接構想一
  // (AI 產文可以反過來餵進主題行程展示牆的內容來源,一魚兩吃)——跟
  // 構想一/二一起構成「吸引訪客→留住訪客→訪客自己產生更多內容」的
  // 核心循環,優先序理由跟構想一/二一致。
  {
    path: '/post-composer',
    title: '構想五：發文工具（圖片處理 + AI 產文）',
    status: 'ready',
    priority: 3,
    desc: '上傳照片假流程 → 比對行程資料 → AI 產文初稿預覽，純前端模擬。',
  },
  // 構想六——4 星(使用者明確拍板次優先,僅次於一/二/五):直接的營收
  // 來源,且已有具體版位設計跟管理後台雛形,落地路徑清楚——在構想一/
  // 二/五確立的核心體驗/內容循環之後,下一步接上去變現,次優先順位
  // 合理。這是總覽頁,放兩種投放模式共通的核心決策(AI 內容不受廣告
  // 影響、隱私權政策需更新等,見 adSystemData.ts 的 KEY_DECISIONS)——
  // 下方兩個附錄才是各自模式的實際雛形/資料結構。
  {
    path: '/ad-system',
    title: '構想六：廣告投放系統',
    status: 'ready',
    priority: 2,
    desc: '贊助卡片在三個候選版位（城市頁/文章頁/範例行程列表）的視覺示意 + 兩種投放模式共通的關鍵決策摘要。',
  },
  // 構想六附錄A——2026-10 拆分:原本單一「構想六附錄：投放設定介面
  // 範例」的 adAdminDemoData.ts 其實混了兩種性質完全不同的廣告主——
  // adv_001~004(在地店家,單一商品素材 DemoCreative)是「贊助模式」:
  // 業主不自己操作後台,透過 email/電話把素材交給內部營運人員代為
  // 上稿,MVP 決策明確寫「第一階段不開放廣告主自助登入」(見
  // docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md 第 0 節)。
  // 這個附錄專指這種「固定檔期、營運代操」的子集合,沿用既有
  // web/admin 風格雛形,不含 adv_005 那組「方案提供者」案例(見附錄B)。
  {
    path: '/ad-admin-demo',
    title: '構想六附錄A：贊助模式（營運代操）',
    status: 'ready',
    priority: 2,
    indent: true,
    desc: '模擬 web/admin 風格的廣告主/活動/素材管理後台（Advertisers/Campaigns/Stats 三分頁），固定檔期計價、內部營運人員代為上稿，不開放廣告主自助登入。純前端假資料。',
  },
  // 構想六附錄B——2026-10 拆分,對應使用者在另一個對話明確要求「建立
  // 獨立的廣告業主控制台」後實際落地的正式後端/前端骨架:跟附錄A的
  // 「贊助模式」是不同商業模式——這裡是廣告業主/聯盟行銷夥伴自己
  // 登入、自己建立活動與方案內容,不經過內部營運人員代操。對應
  // adAdminDemoData.ts 裡 adv_005(日本線旅行社)那組「方案提供者」
  // 案例的資料結構雛形(DemoGroupTourCreative/DemoFlightCreative
  // union),正式後端已落地在 server/internal/partnerconsole(獨立
  // 登入系統,Claims.Sub 存 partnerRow.ID,資料歸屬以 partner_id 隔離)
  // + server/cmd/partnerserver(獨立 binary,/partner/*)+ web/partner
  // (獨立 SPA,/partner/)。這個 handbook 項目之後應該補一頁雛形
  // 展示,目前先登記、沿用附錄A的星等(同一個決策底下的不同呈現形式,
  // 不獨立評分,理由同構想一附錄的既有慣例)。
  {
    path: '',
    title: '構想六附錄B：廣告業主自助控制台',
    status: 'draft',
    priority: 2,
    indent: true,
    desc: '廣告業主/聯盟行銷夥伴自己登入、自己建立活動與方案內容(不經營運代操)，對應 adv_005「方案提供者」案例(團體行程+機票 union)。正式架構已落地：server/internal/partnerconsole + server/cmd/partnerserver + web/partner，三者皆獨立於主站/admin 後台。',
  },
  // 構想七——2026-10 新增,使用者明確要求「導入路徑的機制,讓AI可以選用
  // 路徑作為安排基底」:存放特定旅遊路徑,AI 排行程時可以參考路線沿途
  // 安排站點。構想稿已寫成 RoutePathPlanningPage.tsx(對應
  // 構想頁 /ideas/research-route-path-01 起的研究筆記,兩份內容
  // 同步),status 仍標 'draft'——這只是構想文案/發想稿,不是可互動的
  // 完整雛形(不像構想一/三那樣有假資料卡片牆或面板可以點)。複用的既有
  // 基礎:VITE_FEATURE_PACE 控制的「路徑」(配速表)功能
  // (DesktopShared.tsx PACE_ENABLED、planning/member/phone/Content.tsx 的「路徑」rail
  // 按鈕),實際運作在 web/src/pace/PaceRouteMap.tsx + 後端
  // server/internal/api/pace_route.go(已串接 Google Routes API 算路徑)。
  // 構想七——3 星:有明確差異化價值(沿路徑排行程,不是單點湊順序),且
  // 已確認 encodedPolyline 不能長期持久化(Google TOS 限制),代表落地
  // 時每次都要即時重算,複雜度比原本設想更高;文案構想已完整,但距離
  // 真正可用還有一段資料結構/後端工作要做。
  {
    path: '/route-path-planning',
    title: '構想七：路徑機制（AI 參考旅遊路徑安排行程）',
    status: 'draft',
    priority: 1,
    desc: '存放特定旅遊路徑，AI 排行程時參考路線沿途安排站點——核心問題/資料結構草案/後端角度/前端照片呈現兩種可能性（Google Places 相片 vs 引用部落格素材）的構想稿。複用既有 PaceRouteMap.tsx/pace_route.go（VITE_FEATURE_PACE「路徑」功能）。地圖基底的瀏覽方式延伸雛形見構想一附錄。',
  },
  // 構想八——2026-10 新增,使用者明確確認「構想六是自建投放系統,
  // artifact 是用外部」:跟構想六(站內贊助版位,原生卡片,自己刻版型)
  // 是不同路線,不是同一個構想的延伸或替代,獨立成構想八。內容比較
  // Google AdSense 跟四家旅遊聯盟行銷平台(KKday/Klook/Booking.com/
  // Agoda)外觀彈性/整合複雜度/收益的差異,原始內容由使用者在另一個
  // 對話產生、以 Artifact 連結交付,見 AdAffiliateCompareData.ts 的
  // 完整說明。status 標 'ready'——內容本身已經是完整的視覺化比較頁,
  // 不是文案構想稿。
  // 構想八——4 星:外部聯盟行銷整合複雜度遠低於自建廣告系統(構想六),
  // 多半是申請帳號+換連結+貼 widget,收益結論也已經有初步比較(Klook
  // 最值得優先),是短期內最容易落地的營收管道之一。
  {
    path: '/ad-affiliate-compare',
    title: '構想八：廣告與聯盟行銷方案比較（外部平台）',
    status: 'ready',
    priority: 1,
    desc: '比較 Google AdSense 跟 KKday/Klook/Booking.com/Agoda 四家聯盟行銷平台——外觀彈性量尺、收益對照、整體比較表。',
  },
  // 構想九~二十一(2 星,統一說明見上方 priority 型別註解):純登記性質,
  // 優先序留待真正要往下發展時個別重新評估。
  // 構想九~二十一——2026-10 新增:使用者要求「掃描 docs/ 底下所有文件,
  // 找出提到的產品構想/功能發想,簡短列出並附文件關聯」。這批構想只是
  // 登記性質(status 一律 'draft'),不是完整雛形。原始文件已改寫成
  // 「一個構想一頁」(見 ideas/),path 指向對應的構想頁,desc 附上詳見的
  // 頁面;仍保留在 docs/ 的來源文件(研究筆記系列)維持列出路徑。
  //
  // 構想九~十四來源:功能腦力激盪(10 項統整,/ideas/product-feature-*,
  // 其中第 2 項「行程健檢」已是構想四,不重複列入)、功能優先序
  // (/ideas/product-feature-priorities,同一批 10 項的落地順序規劃,
  // 延續同一批構想,非獨立主題)。
  {
    path: '/ideas/product-feature-1-inspiration-inbox',
    title: '構想九：靈感收件匣（貼上即成行程）',
    status: 'draft',
    priority: 1,
    desc: '把 IG/小紅書/截圖/朋友訊息整段貼進來，AI 抽出地點/場次比對成真實地標，收進候選池建議插入日程。（詳見構想頁：/ideas/product-feature-1-inspiration-inbox；落地順序見 /ideas/product-feature-priorities）',
  },
  {
    path: '/ideas/product-feature-3-conversational-replan',
    title: '構想十：對話式重排（模糊指令 + 連鎖順延 + diff 預覽）',
    status: 'draft',
    priority: 1,
    desc: '一句「下午太趕幫我鬆一點」讓 AI 重排整段，刪移項目自動順延補位，所有批次改動先 diff 預覽再套用，可一鍵還原。（詳見構想頁：/ideas/product-feature-3-conversational-replan；落地順序見 /ideas/product-feature-priorities）',
  },
  {
    path: '/ideas/product-feature-4-transit-autofill',
    title: '構想十一：接駁自動補齊（交通是一等公民）',
    status: 'draft',
    priority: 1,
    desc: '景點之間自動補上交通方式、時間、花費，依情境判斷（拖行李→計程車、有 JR Pass→優先 JR），在末班車/停駛等斷點主動警示。（詳見構想頁：/ideas/product-feature-4-transit-autofill；落地順序見 /ideas/product-feature-priorities）',
  },
  {
    path: '/ideas/product-feature-5-gap-radar',
    title: '構想十二：空檔雷達（時間感知推薦）',
    status: 'draft',
    priority: 1,
    desc: '偵測行程中尷尬的時間空檔，依當時位置、營業狀態、前後脈絡推薦合適的補位選項。（詳見構想頁：/ideas/product-feature-5-gap-radar；落地順序見 /ideas/product-feature-priorities）',
  },
  {
    path: '/ideas/product-feature-6-companion-voting',
    title: '構想十三：旅伴共決 + 旅費分帳 + 訂單轉寄收件匣',
    status: 'draft',
    priority: 1,
    desc: '旅伴把候選地點丟進共享候選池滑卡表態、AI 彙整衝突提折衷方案供表決；行程卡掛花費自動分帳結清；專屬 email 收轉寄訂單確認信自動解析進時間軸。（詳見構想頁：/ideas/product-feature-6-companion-voting、/ideas/product-feature-9-expense-splitting、/ideas/product-feature-10-booking-forward-inbox）',
  },
  {
    path: '/ideas/product-feature-7-copy-and-adapt',
    title: '構想十四：一鍵複製 + AI 改編別人公開的行程',
    status: 'draft',
    priority: 1,
    desc: '看到別人公開分享的行程按「複製成我的」，告訴 AI 天數/人數/限制（例如帶小孩），自動改編成自己的版本。（詳見構想頁：/ideas/product-feature-7-copy-and-adapt；落地順序見 /ideas/product-feature-priorities）',
  },
  // 構想十五來源:景點策展方向一路延伸的研究筆記系列(同一條主題的
  // 多輪文件,依規則全部附上):資料模型關聯性案例研究 → 延伸探索操作
  // 流程 → 分類密度/行程狀態/多錨點下一步發想 → 單一景點敘事內容發想,
  // 加上兩份候選地點盤點(資料面延伸,同一方向下的素材儲備)。
  {
    path: '/ideas/research-storytelling-overview',
    title: '構想十五：精選景點策展與敘事深化',
    status: 'draft',
    priority: 1,
    desc: '主題點/精選點的關聯性判準、延伸探索（「為什麼跟這裡有關」的視覺化關聯鏈）、資料量成長後的密度管理（圖例即控制器/三層精選層級/坂段分組）、單一景點三幕式敘事內容生產。（來源：docs/research-curated-attraction-relationships-2026-08.md, docs/research-attraction-explore-ux-2026-08.md, docs/research-curated-attraction-next-steps-2026-09.md, docs/research-taiwan-attraction-candidates-2026-09.md, docs/research-tainan-attraction-candidates-2026-09.md；單一景點敘事內容發想見構想頁 /ideas/research-storytelling-overview）',
  },
  {
    path: '/ideas/research-companion-01',
    title: '構想十六：旅伴應徵配對（建立在路徑之上）',
    status: 'draft',
    priority: 1,
    desc: '使用者選一條既有路徑（或當場新建）發布成「應徵旅伴」貼文，設定旅伴條件，其他使用者瀏覽提出配對，條件相符開聊天室自行洽談。建立在構想七的路徑機制之上。（詳見構想頁：/ideas/research-companion-01；另見構想七的路徑機制 /ideas/research-route-path-01）',
  },
  {
    path: '/ideas/design-overview',
    title: '構想十七：行程規劃引導介面（候選籃為核心的空間化規劃流程）',
    status: 'draft',
    priority: 1,
    desc: '一步步引導使用者規劃行程的介面：候選籃常駐容器、住宿錨點長成日層架、對話即候選來源、就近備胎補洞、多源事實對帳、接縫時間、留白格等 15 項構想共同支撐的一套規劃機制。（詳見構想頁：/ideas/design-overview（15 項構想各一頁））',
  },
  {
    path: '/ideas/ai-r1-overview',
    title: '構想十八：AI 主動規劃行程的能力邊界與風險標示設計',
    status: 'draft',
    priority: 1,
    desc: '三輪三方角色設計討論：第一輪在地基未補齊現況下定案 15 項構想（哪些結論是臨時性、該怎麼標示風險）；第二輪在交通時間/營業時間查詢補齊後重新檢視同一批議題；願景篇反過來問「AI 做得好時能帶來什麼新價值」。（詳見構想頁：第一輪 /ideas/ai-r1-overview、第二輪 /ideas/ai-r2-overview、願景篇 /ideas/vision-overview）',
  },
  {
    path: '/ideas/product-want-traveler-3-offline',
    title: '構想十九：旅行中的離線保障與行程被打亂時的即時救援',
    status: 'draft',
    priority: 1,
    desc: '沒網路時仍能看到今天行程基本資訊、離線時的修改不遺失並於恢復連線後自動補上；臨時卡關（下大雨、店家臨時公休、晚了 40 分鐘）時一句話重排今天剩餘行程並保住訂位等鎖定項目，改壞了可以退回上一步。（詳見構想頁：/ideas/product-want-traveler-3-offline、/ideas/product-want-traveler-4-disruption、/ideas/product-feature-8-today-mode）',
  },
  {
    path: '/ideas/product-want-traveler-5-elders-sharing',
    title: '構想二十：給長輩看的簡化分享版 + 日曆/通知整合',
    status: 'draft',
    priority: 1,
    desc: '分享給不熟手機操作的家人時提供大字、只能看不能誤觸的簡化版本；連結可設定幾天後自動失效；行程一鍵送進手機內建日曆與提醒；有人邀請或改動行程時主動通知。（詳見構想頁：/ideas/product-want-traveler-5-elders-sharing）',
  },
  {
    path: '/ideas/product-want-traveler-6-memories',
    title: '構想二十一：行程照片日記（照片貼回當天行程旁）',
    status: 'draft',
    priority: 1,
    desc: '把旅途中拍的照片直接貼在對應那天、那個地點旁邊，回頭看行程時像翻一本圖文並茂的旅遊日記，而不是乾巴巴的地名清單。（詳見構想頁：/ideas/product-want-traveler-6-memories）',
  },
  // 內部架構文件——2026-10 新增,性質跟上面的產品構想不同:它不是「要不要
  // 做」的發想,是把「已經長成這樣」的現況整理成一張圖(定位同構想二的
  // 元件庫文件化)。沒有產品優先序可言,故給 1 星——星等欄位是為了排序
  // 產品構想設計的,對文件頁沒有意義,但型別要求必填。放在清單最後,
  // 標題用「內部文件」前綴跟構想區隔。
  {
    path: '/plan-data-flow',
    title: '內部文件：行程資料的分層架構',
    status: 'ready',
    priority: 1,
    desc: 'PlanTimeline 存在哪、誰能改、四種輸入來源（模擬推論／真實 AI／使用者操作／持久化回讀）各自接在哪一層。新增輸入來源或資料操作時，「這該放哪一層」的答案。',
  },
  // 規劃地圖架構文件——2026-10 新增:四個入口(/ai-plan 手機與桌面、登入後手機與桌面)的分層、
  // 統一繪製層、逐項對照表與重要決策紀錄。內容是獨立的靜態 HTML(public/marker-layers.html),
  // 這個路由用 iframe 嵌入。同樣沒有產品優先序,星等給 1。
  {
    path: '/marker-layers',
    title: '內部文件：規劃地圖的分層與繪製層',
    status: 'ready',
    priority: 1,
    desc: '四個入口各自怎麼接同一組分層元件、統一繪製層的功能層、五欄逐項對照表(播放態、推論態、桌面、登入後),以及重要決策紀錄。改地圖、面板或入口接線前先看這一頁。',
  },
  // 時間軸架構文件——2026-10 新增:時間軸資料(PlanNode 鏈結串列)與五個使用端(擁有者、資料來源、檢視)的對照。
  // 內容是獨立的靜態 HTML(public/timeline-architecture.html),路由用 iframe 嵌入,做法同 /marker-layers。
  {
    path: '/timeline-architecture',
    title: '內部文件：時間軸的資料結構與使用端',
    status: 'ready',
    priority: 1,
    desc: '時間軸資料是 PlanNode 鏈結串列、五個入口共用同一份結構與同一組純函式；桌面直向與手機橫向兩個檢視，各端差別只在誰持有狀態、資料從哪來、用哪個檢視。改時間軸或新增入口前先看這一頁。',
  },
  // 構想總覽——原本散在 docs/ 的構想文件(產品構想、AI 排行程的多輪設計
  // 討論、行程規劃設計討論、研究發想)改寫成「一個構想一頁」後的入口,
  // 內容在 ideas/ 底下(見 ideas/types.ts)。docs/ 裡的原始文件已移除。
  {
    path: '/ideas',
    title: '構想總覽（原 docs/ 構想文件，一個構想一頁）',
    status: 'ready',
    priority: 1,
    desc: '產品構想、AI 排行程三輪設計討論（第一輪／第二輪／願景篇）、行程規劃設計討論與研究發想，依群組列出，可搜尋，點進去看每個構想的完整內容與討論過程。',
  },
]

// ARCHIVED_ITEMS——2026-10 新增:使用者指出「散策羅盤」已經是這個專案
// 既有、已實作上線的真實功能(不是這次新發想的構想),要登記進 showcase-
// demo 但跟上面「構想一~二十一」的雛形/發想性質不同——這裡是「已經做完、
// 不需要再推進」的封存區,純粹歸檔/備查用途。不套用 ITEMS 的
// status/priority 欄位:封存項目不是「draft 待開發」或「ready 雛形
// 完成」,是已實作上線;也不需要優先序,因為已經做完了。
//
// 散策羅盤的實際定義(見 docs/terminology.md「主題點／精選點」條目、
// docs/research-curated-attraction-relationships-2026-08.md 第 194~198
// 行命名由來):地圖探索頁(web/src/geo-planning/、ExploreMap.tsx/
// AttractionInfoPanel.tsx/useAttractionOverlays.ts)裡「主題點→揭露周邊
// 精選點」的分級點擊機制——點開主題點(大地標)後,依步行分鐘數由近到遠
// 揭露周邊精選點(小地點),介紹卡內附「附近景點」清單(分類圖示+距離
// 分鐘+一句話簡介),清單與地圖圓點 hover 雙向連動。對應的使用者可見
// 頁面:/jiufen、/kyoto-kiyomizu、/tainan-anping 等城市主題介紹頁
// (web/src/home/InteractiveExploreMap.tsx)以及主要行程規劃頁
// /app(web/src/geo-planning/ExploreMap.tsx + planning/member/desktop/Content.tsx)。
const ARCHIVED_ITEMS: {
  title: string
  desc: string
  docLinks: string[]
}[] = [
  {
    title: '散策羅盤（主題點/精選點鄰近揭露機制）',
    desc: '地圖探索頁的既有功能:點開主題點(大地標)後,依步行分鐘數揭露周邊精選點(小地點),主題介紹卡內附「附近景點」清單(分類圖示+距離分鐘+簡介),清單與地圖圓點雙向連動;點擊精選點開「地點卡」(與飯店/推薦地點共用)。已實作上線,對應頁面:/jiufen、/kyoto-kiyomizu、/tainan-anping、/app。前端核心邏輯:web/src/geo-planning/useAttractionOverlays.ts(主題點/精選點揭露邏輯),另見同目錄 ExploreMap.tsx、AttractionInfoPanel.tsx、geoNearbyAttractions.ts、geoAttractionOverlay.ts、web/src/home/InteractiveExploreMap.tsx。後端資料模型:server/internal/model/model.go 的 Attraction.IsTheme/RadiusMeters 欄位。',
    docLinks: [
      'docs/terminology.md（「主題點／精選點」條目）',
      'docs/research-curated-attraction-relationships-2026-08.md（「散策羅盤」命名與視覺方向定案由來）',
      'docs/research-curated-attraction-next-steps-2026-09.md（第一輪落地範圍總結）',
      'docs/attraction-theme-points-2026-09.md（各城市主題點/精選點分級盤點）',
      'docs/handoff-attraction-theme-place-cards-2026-09.md（主題點/地點卡並存機制工作交接）',
    ],
  },
]

// 首頁分類(見 categories.ts)——ITEMS 依這兩個規則分到兩個分類頁:
//   - 標題以「內部文件」開頭 → 系統文件(連同下方封存區)
//   - path 是 /ideas(構想總覽)→ 不列在這裡,它對應「構想」分類
//   - 其餘(構想一~二十一的雛形與登記項目)→ 點子開發
export type ItemMode = 'prototypes' | 'system-docs'

function itemMode(item: { path: string; title: string }): ItemMode | null {
  if (item.path === '/ideas') return null
  return item.title.startsWith('內部文件') ? 'system-docs' : 'prototypes'
}

export function itemsOfMode(mode: ItemMode) {
  return ITEMS.filter((i) => itemMode(i) === mode)
}

// itemCountOfMode——分類卡片上顯示的篇數;系統文件另外加上封存區的項目。
export function itemCountOfMode(mode: ItemMode): number {
  return itemsOfMode(mode).length + (mode === 'system-docs' ? ARCHIVED_ITEMS.length : 0)
}

export function HandbookIndex({ mode }: { mode: ItemMode }) {
  const category = getCategory(mode)
  const items = itemsOfMode(mode)
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>← 首頁</Link>
        <h1 className={styles.heading}>{category?.title ?? '產品方向雛形試做'}</h1>
        <p className={styles.subheading}>
          {mode === 'system-docs' ? category?.blurb : null}
          {mode === 'prototypes' ? (
            <>
          構想一～六對應產品方向腦力激盪（/ideas/product-direction-*），構想七/八是後續延伸的獨立構想，
          構想九以後是掃描 docs/ 底下其他文件找出的構想登記（僅簡短列出 + 對應構想頁連結，非完整雛形）。
          原本散在 docs/ 的構想文件已改寫成一個構想一頁，總覽見「構想總覽」。
          這些頁面純供內部查看，不對外公開連結，資料皆為前端假資料，沒有真實後端串接。
            </>
          ) : null}
        </p>
        <ul className={styles.list}>
          {items.map((item) => {
            // path 空字串——2026-10 新增(見構想七的完整說明):還沒建立
            // 對應頁面的佔位登記項目,刻意不給真實路由。用 <div> 而非
            // <Link> 渲染,避免 <Link to=""> 的相對路徑行為(會連回目前
            // 頁面本身)誤導使用者以為這是可點擊的連結。
            const content = (
              <>
                <div className={styles.itemTitle}>
                  {item.title}
                  <span
                    className={`${styles.itemStatus}${item.status === 'ready' ? ` ${styles.itemStatusReady}` : ''}`}
                  >
                    {item.status === 'ready' ? '雛形完成' : '草稿'}
                  </span>
                  {/* 星等——2026-10 新增(見上方 priority 型別/ITEMS 陣列
                      註解的完整說明)。用實心★數量直接表達,不用數字,
                      掃過清單時視覺上能立刻比較出相對優先順序,不需要
                      停下來讀數字再換算。aria-label 把星等用人類可讀的
                      句子唸出來,畫面上的★●不具備語意,螢幕閱讀器直接
                      唸特殊字元會很難聽懂。 */}
                  <span className={styles.itemPriority} aria-label={`優先序 ${item.priority} 星(滿分 3 星)`}>
                    {'★'.repeat(item.priority)}
                    <span aria-hidden="true" className={styles.itemPriorityMuted}>
                      {'★'.repeat(3 - item.priority)}
                    </span>
                  </span>
                </div>
                <p className={styles.itemDesc}>{item.desc}</p>
              </>
            )
            // indent 項目套用 itemIndented(縮排 + 左側引導線,見該
            // class 的完整說明),表達「從屬於上一個主項目」的層級——
            // 用 join 而非字串模板拼接,避免 item.path 為空、itemIndented
            // 沒套用時留下多餘的尾端空白 class。
            const itemClassName = [styles.item, item.indent ? styles.itemIndented : null]
              .filter(Boolean)
              .join(' ')
            return (
              <li key={item.title}>
                {item.path ? (
                  <Link to={item.path} className={itemClassName}>
                    {content}
                  </Link>
                ) : (
                  <div className={itemClassName} aria-disabled="true">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {mode === 'system-docs' && (
          <>
        {/* 封存區——2026-10 新增:使用者要求登記「散策羅盤」這個已實作
            上線的既有功能,跟上面「構想一~二十一」的雛形/發想性質不同
            (封存區是「已經做完、不需要再推進」的歸檔/備查用途),視覺上
            刻意跟構想清單區分開(較低調的灰階標題 + 無星等/狀態標籤 +
            純文字 <div> 不可點擊),避免使用者掃過清單時誤以為這些也是
            待開發的構想。 */}
        <h2 className={styles.archiveHeading}>封存區（已實作完成，純歸檔備查）</h2>
        <p className={styles.archiveSubheading}>
          以下是這個專案既有、已經做完上線的真實功能，記錄在這裡純粹是歸檔/備查用途，不是待辦清單，不需要再推進。
        </p>
        <ul className={styles.archiveList}>
          {ARCHIVED_ITEMS.map((item) => (
            <li key={item.title}>
              <div className={styles.archiveItem} aria-disabled="true">
                <div className={styles.archiveItemTitle}>{item.title}</div>
                <p className={styles.archiveItemDesc}>{item.desc}</p>
                <ul className={styles.archiveDocList}>
                  {item.docLinks.map((doc) => (
                    <li key={doc}>{doc}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
          </>
        )}
      </div>
    </div>
  )
}
