// demoScript.ts — 小展示(首頁 ScrollPlanDemo.tsx / /product
// FeatureShowcase.tsx,見 docs/terminology.md「/ai-plan 展示頁三階段」
// 的完整定義)專用的獨立劇本,2026-10 新增(使用者明確要求「小展示只留
// 5 個」景點站)。
//
// 刻意不跟播放態(/ai-plan 展示頁,planning/preview/Content.tsx)共用
// planSimScript.ts 的 PLAN_SIM_SCRIPT,也不讓 createPlanSimFakeSource/
// createPlanSimScrollSource 新增「要播幾站」這種參數去讀同一份劇本切出
// 子集合——使用者明確要求兩者是分離的概念(小展示/播放態各自獨立,不是
// 「同一份資料、不同播放範圍」的關係):這份檔案的內容是 PLAN_SIM_SCRIPT
// 前 5 個 add_stop 站點(赤崁樓周邊/午餐候選/神農街/孔廟周邊/國立臺灣
// 文學館)的靜態拷貝,日後兩邊各自想怎麼調整(小展示想換內容、播放態想
// 加站點)都不會牽動到對方,不需要共用的 source 函式簽名保持同步。
//
// 內容複製自 planSimScript.ts 2026-10-18 當時的前 5 站(含依附在站點
// 之間的 add_note/add_message),逐字對照過——日後若要調整小展示的
// 內容,直接改這份檔案,不需要回頭比對 PLAN_SIM_SCRIPT。
//
// 刻意不含 open_ask_page(2026-10):PLAN_SIM_SCRIPT 的第一則是那個
// 動作,但小展示的畫面(AiPlanPhoneDemoScreen)沒有接 AskPage 的三個
// prop(showAskPage/askPageInput/onAskPageDone),詢問頁在這裡永遠不會
// 渲染——那一則在小展示裡只會讓捲動多出兩個完全沒有畫面變化的步驟
// (約佔總進度的 10%,接近一個螢幕高度的死區),沒有任何敘事作用。
//
// 附帶的好處是這份劇本不再依賴 PlanAction 的 'open_ask_page' 型別
// 擴充,小展示這條線可以獨立於 /ai-plan 的改動之外。日後若小展示也要
// 有詢問頁,要同時補上 AiPlanPhoneDemoScreen 的 AskPage 接線,不是只把
// 這一則加回來。

import type { PlanAction } from './planAction'

export const DEMO_SCRIPT: PlanAction[] = [
  {
    type: 'add_message',
    id: 'msg-chikanlou-intro',
    text: '早上先從赤崁樓開始，08:30 剛好開館可以避開排隊人潮，園區不大，安排 1 小時走逛剛剛好。',
  },
  {
    type: 'add_stop', id: 'stop-chikanlou-area', time: '08:30', day: 1, duration: '停留 3h', kind: '景點',
    name: '赤崁樓周邊', desc: '從荷蘭時期古蹟赤崁樓出發，順遊鄰近的祀典大天后宮、武廟愛玉、日安良食鳳凰卷、祀典武廟與義豐冬瓜茶，步行距離都在 5 分鐘內。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)', thumbIcon: '🏯',
    tags: ['08:30 開館'],
    placeId: 'attr-chikanlou',
    lat: 23.0009, lng: 120.2024,
    places: ['attr-chikanlou', 'attr-datianhou', 'attr-wumiao-aiyu', 'attr-riann-fenghuangjuan', 'attr-wumiao', 'attr-yifeng-wintermelon'],
  },
  {
    type: 'add_note', id: 'note-reconsider', afterId: 'stop-chikanlou-area', category: 'consideration',
    text: '大天后宮距離赤崁樓稍近可以順路安排；週二香客較多，建議 10 點前抵達祀典武廟；中午前後日曬強烈，可以先買杯冬瓜茶消暑再繼續逛。',
  },
  {
    type: 'add_stop', id: 'stop-lunch', time: '11:30', day: 1, duration: '停留 1h', kind: '午餐',
    name: '午餐候選', desc: '虱目魚粥與土魠魚羹的在地經典早午餐店，或是傳承多代的肉圓老店，兩個都在永福路/民族路一帶，步行距離都很近。',
    thumbBg: 'linear-gradient(135deg, #D9A97D, #C4956A)', thumbIcon: '🍚',
    placeId: 'attr-atang',
    lat: 22.9976, lng: 120.1975,
    candidateCards: true,
    places: ['attr-atang', 'attr-fuji-meatball'],
    farFromNext: ['attr-fuji-meatball'],
  },
  {
    type: 'add_stop', id: 'stop-shennong', time: '13:30', day: 1, duration: '停留 2h', kind: '景點・散策',
    name: '神農街', desc: '老屋改建的文創街區，木造街屋與燈籠交錯，白天則是老屋立面與文創小店的悠閒散策路線。',
    thumbBg: 'linear-gradient(135deg, #8B3A2F, #2B2420)', thumbIcon: '🏮',
    placeId: 'attr-shennong',
    lat: 22.9987, lng: 120.1971,
  },
  {
    type: 'add_stop', id: 'stop-confucius-area', time: '09:00', day: 2, duration: '停留 2h', kind: '景點',
    name: '孔廟周邊', desc: '從全台首學孔廟出發，接著逛府中街一帶的孔廟商圈文創聚落，步行距離都在 5 分鐘內。',
    thumbBg: 'linear-gradient(135deg, #8B7A2F, #4A3626)', thumbIcon: '🏛️',
    tags: ['免費開放參觀'],
    placeId: 'attr-confucius-temple',
    lat: 22.9908, lng: 120.2035,
    places: ['attr-confucius-temple', 'attr-confucius-temple-cultural-zone'],
  },
  { type: 'add_note', id: 'note-3', afterId: 'stop-confucius-area', category: 'weather', text: '下午降雨機率 60%，園區內有不少樹蔭可以躲雨' },
  {
    type: 'add_stop', id: 'stop-literature-museum', time: '11:20', day: 2, duration: '停留 1h', kind: '景點',
    name: '國立臺灣文學館', desc: '原台南州廳修復再利用，紅磚拱廊與現代圓弧量體並存，常設展呈現台灣文學發展脈絡。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #4A3626)', thumbIcon: '📚',
    tags: ['免費參觀'],
    placeId: 'attr-literature-museum',
    lat: 22.9915, lng: 120.2039,
  },
  { type: 'add_note', id: 'note-literature-museum', afterId: 'stop-literature-museum', category: 'weather', text: '中午時段日曬最強，館內有冷氣可以避暑順便慢慢逛' },
  { type: 'done' },
]
