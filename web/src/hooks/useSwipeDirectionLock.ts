import { useRef } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'

// useSwipeDirectionLock——2026-10 抽出:原本這套「位移閾值 + 水平/垂直
// 比例判定 + 鎖定後 stopPropagation()」的手勢仲裁邏輯,只寫在
// geo-planning/PhotoCarousel.tsx 的 MobileSwipeStrip 裡(解決「橫滑照片
// 時不能連動觸發外層 PhoneBottomSheet 垂直拖曳」的衝突,見該檔案原本
// touchStateRef 的完整說明)——使用者詢問「react-native-gesture-handler
// 的做法可以套用在網頁上嗎」,調查後確認該函式庫本身依賴 React Native
// 原生橋接,無法直接搬進這個純 React DOM 專案,但它的核心概念(宣告式
// 的方向鎖定/手勢仲裁,對應其 Gesture.Pan().activeOffsetX()/failOffsetY()
// 這類 API)值得移植——這裡把 PhotoCarousel 已經寫好的判斷邏輯抽成通用
// hook,讓任何「橫向手勢需要跟外層縱向拖曳仲裁」的元件都能直接複用這份
// 判斷,不需要各自重新刻一份方向判斷+手動 stopPropagation()。
//
// 設計上只解決「這個專案目前真正遇到的那個衝突」(水平 vs 垂直二選一
// 鎖定,鎖定後整個觸控週期不變),不是整套 react-native-gesture-handler/
// @use-gesture 那種可疊加、可宣告多手勢同時辨識/互斥關係的框架——後者
// 目前沒有實際需求支撐這麼複雜的抽象,過度設計反而增加理解成本(對照
// zLayers.ts/useSheetStack.ts 的既有分工:通用 hook 只管「這一種」仲裁,
// 不是無所不包的手勢引擎)。
//
// 回傳的三個 handler 直接掛在呼叫端自己的 onTouchStart/onTouchMove/
// onTouchEnd 上(呼叫端通常還有自己的邏輯要跑,例如 MobileSwipeStrip
// 原本就只用這三個 handler 做方向鎖,沒有額外邏輯要疊加,見下方用法)。
//
// lockedAxis:這個 hook 允許「通過鎖定」的軸向——'horizontal' 代表水平
// 為主時鎖定為這個方向、呼叫 stopPropagation() 擋掉冒泡(不讓外層的
// 縱向手勢,例如 PhoneBottomSheet 的拖曳,收到這次觸控);垂直為主時
// 完全不攔截,正常冒泡給外層處理。'vertical' 則相反語意,供「外層其實是
// 要攔截橫向手勢、放行縱向手勢」這種鏡像情境使用(目前沒有呼叫端用到,
// 預留給未來對稱需求,不是臆測的過度設計——只是讓這個 hook 不隱含
// 「永遠是橫向元件」這種假設,介面保持中性)。
export function useSwipeDirectionLock(
  lockedAxis: 'horizontal' | 'vertical',
  // thresholdPx:方向判定前的最小位移門檻(px)——手指剛觸碰螢幕時幾乎
  // 不會是完全靜止的直線移動,幾像素內的雜訊位移不該被當成方向判斷依據
  // (原始邏輯見 PhotoCarousel.tsx 的 DIRECTION_LOCK_THRESHOLD_PX),預設
  // 值沿用那裡驗證過的 6px,呼叫端有特殊需求才需要覆寫。
  thresholdPx = 6,
) {
  // touchStateRef:同一輪觸控(touchstart 到 touchend)共用的狀態——
  // locked 為 null 代表尚未判定方向,判定後固定下來,整個觸控週期不再
  // 改變(常見的方向鎖行為,避免使用者滑動路徑微幅斜向時方向判斷來回
  // 跳動、手感忽鎖忽放,理由同 PhotoCarousel.tsx 原始版本的完整說明)。
  const touchStateRef = useRef<{ startX: number; startY: number; locked: 'horizontal' | 'vertical' | null } | null>(
    null,
  )

  function onTouchStart(e: ReactTouchEvent) {
    const touch = e.touches[0]
    touchStateRef.current = { startX: touch.clientX, startY: touch.clientY, locked: null }
  }

  function onTouchMove(e: ReactTouchEvent) {
    const state = touchStateRef.current
    if (!state) return
    const touch = e.touches[0]
    const dx = touch.clientX - state.startX
    const dy = touch.clientY - state.startY

    if (state.locked === null) {
      if (Math.abs(dx) < thresholdPx && Math.abs(dy) < thresholdPx) return
      state.locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }

    if (state.locked === lockedAxis) {
      e.stopPropagation()
    }
  }

  function onTouchEnd(e: ReactTouchEvent) {
    if (touchStateRef.current?.locked === lockedAxis) {
      e.stopPropagation()
    }
    touchStateRef.current = null
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
