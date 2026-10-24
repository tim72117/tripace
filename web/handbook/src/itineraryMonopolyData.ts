// itineraryMonopolyData.ts — 構想一附錄三「大富翁棋盤時間軸」雛形假資料。
//
// 緣起(2026-10):使用者提出「時間軸做成大富翁，地圖中間，外圈掛上時間軸」
// ——地圖置中當棋盤內盤，行程站點沿外圈排成棋盤格、依序繞一圈,呼應大富翁
// 「依序走格子」的視覺隱喻,天然適合表達「這份行程的站點順序」這件事,跟
// 構想一附錄(地圖為主要互動介面,路徑線沿畫面斜切)、構想一附錄二(整頁
// 總覽式懶人包)是第三種呈現方式,三者互補。
//
// 棋盤格總數跟真實大富翁一樣是外圈一圈的格子(這裡固定 16 格:四邊各
// 4~5 格,角落 4 格),不是每一站對應一格——站數少於格數時其餘格子顯示
// 「過路格」(純裝飾,不對應任何站點,呼應大富翁地圖裡的「機會」「命運」
// 之類無主題格子),這樣不論行程站數多寡,棋盤外觀都維持同樣大小、不會
// 因為站少而變形。
//
// 座標用「第幾格(0-based,從左上角順時針繞)」而非 xPct/yPct 百分比——
// 棋盤格排列是規則網格,用格數定位比用任意百分比更貼近大富翁的實際版面
// 邏輯,渲染端(ItineraryMonopolyPage.tsx)依格數自己算出四邊對應的
// grid-area。

export type MonopolySquareKind = 'stop' | 'pass'

export interface MonopolySquare {
  // slot——第幾格,0-based,從左上角順時針繞一圈。
  slot: number
  kind: MonopolySquareKind
  // 以下欄位只有 kind === 'stop' 時才有值。
  id?: string
  time?: string
  name?: string
  category?: string
  emoji?: string
  desc?: string
  stayMinutes?: number
}

export interface MonopolyItinerary {
  id: string
  title: string
  desc: string
  totalSlots: number
  squares: MonopolySquare[]
}

// TOTAL_SLOTS——棋盤外圈總格數,16 格對齊真實大富翁(四邊各含頭尾角落
// 共 4*4=16),角落格(0/4/8/12)視覺上放大當作「起點」「中繼點」風格的
// 標記格,呼應大富翁角落格(起點/監獄/免費停車/入獄)的既有印象,但內容
// 换成行程站點,不是真的套用大富翁規則。
const TOTAL_SLOTS = 16

// STOPS——九份一日散策的站點(沿用 ai-itineraries/itineraries/jiufen-1day.ts
// 同一份真實範例行程的站點內容,方便跟正式功能的資料對照),故意只有 6 站,
// 少於 16 格總數,用來示範「過路格」的視覺效果。
const STOPS: Omit<MonopolySquare, 'slot' | 'kind'>[] = [
  { id: 's1', time: '10:00', name: '九份老街入口', category: '景點', emoji: '🏮', desc: '從輕便路開始，避開中午人潮高峰前先逛半小時', stayMinutes: 30 },
  { id: 's2', time: '10:30', name: '阿妹茶樓', category: '美食', emoji: '🍵', desc: '《神隱少女》取景地，建議拍照後再進去喝茶', stayMinutes: 90 },
  { id: 's3', time: '12:00', name: '九份芋圓', category: '美食', emoji: '🍡', desc: '在地排隊名店，建議外帶邊走邊吃', stayMinutes: 90 },
  { id: 's4', time: '14:00', name: '昇平戲院', category: '景點', emoji: '🎬', desc: '台灣現存最古老戲院之一，免費參觀', stayMinutes: 150 },
  { id: 's5', time: '16:30', name: '基山街小吃', category: '美食', emoji: '🥟', desc: '黃昏前的山城光線最適合拍照', stayMinutes: 90 },
  { id: 's6', time: '18:00', name: '豎崎路看夜景', category: '景點', emoji: '🌆', desc: '華燈初上，九份最經典的階梯夜景角度', stayMinutes: 60 },
]

// 把 6 個站點分散到 16 格外圈——刻意不是連續排滿前 6 格,而是依大致等
// 距離分佈(每隔 2~3 格放一站),讓棋盤外觀更接近「繞一整圈」的節奏感,
// 而不是「站點全擠在起點附近、後半圈全空」。
const STOP_SLOTS = [0, 3, 5, 8, 11, 13]

function buildSquares(): MonopolySquare[] {
  const squares: MonopolySquare[] = []
  for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
    const stopIndex = STOP_SLOTS.indexOf(slot)
    if (stopIndex >= 0) {
      squares.push({ slot, kind: 'stop', ...STOPS[stopIndex] })
    } else {
      squares.push({ slot, kind: 'pass' })
    }
  }
  return squares
}

export const MONOPOLY_ITINERARY: MonopolyItinerary = {
  id: 'jiufen-1day-monopoly',
  title: '九份一日散策',
  desc: '地圖置中當棋盤內盤，行程站點沿外圈棋盤格依序排列——像走大富翁一樣，一格一格走完這一天。',
  totalSlots: TOTAL_SLOTS,
  squares: buildSquares(),
}
