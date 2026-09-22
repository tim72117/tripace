import { useEffect, useRef, useState } from 'react'

// useScrollProgress:城市介紹頁(KyotoPage/JiufenPage/TainanPage)共用的
// 捲動進度邏輯——原本三份檔案各自貼了一份逐字相同的 IntersectionObserver
// 設置(約 25 行),抽成這個 hook 統一維護。activeIndex 驅動進度點列與
// 每個站點 section 的 is-active class(觸發文字淡入淡出)。
//
// -1 是專屬於開頭互動地圖區塊(mapIntroRef)的特殊值,0 以上對應呼叫端
// STOPS 陣列的索引——初始值就是 -1,因為頁面一載入、還沒開始捲動時,
// 使用者本來就正在看地圖區塊,這個 icon 點應該從一開始就是高亮狀態,
// 不需要等使用者捲動一次才會顯示正確的高亮位置。
//
// threshold 0.5:站點區塊過半進入視窗才算「目前站點」,避免捲動途中
// 兩個區塊同時觸發、進度點跳來跳去。
//
// stopRefs 由呼叫端傳入(每個城市頁的站點數量/內容不同,這個 hook 不
// 關心站點本身,只負責觀察 DOM 節點的可視進度),回傳同一個 ref 供
// 呼叫端在 JSX 的 ref={(el) => { stopRefs.current[i] = el }} 掛上。
export function useScrollProgress(stopCount: number, mapIntroRef: React.RefObject<HTMLDivElement | null>) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const stopRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const els = stopRefs.current.filter((el): el is HTMLElement => el !== null)
    // mapIntroRef 一併加入觀察名單(data-index="-1",對應上方 activeIndex
    // 的特殊值)——讓「回到地圖」圖示點在使用者實際捲動到地圖區塊時
    // 也能正確套用 .is-active 高亮效果。
    if (mapIntroRef.current) mapIntroRef.current.setAttribute('data-index', '-1')
    const allEls = mapIntroRef.current ? [mapIntroRef.current, ...els] : els
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('is-active'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number(entry.target.getAttribute('data-index'))
          entry.target.classList.toggle('is-active', entry.isIntersecting)
          if (entry.isIntersecting) setActiveIndex(idx)
        })
      },
      { threshold: 0.5 },
    )
    allEls.forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopCount])

  return { activeIndex, stopRefs }
}
