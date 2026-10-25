// PlanTimelineView 的「先站位」:資料還沒到/載入失敗/沒有照片時,卡片、縮圖、交通膠囊的外框照樣渲染同一組 class,
// 還沒有的文字畫佔位條;資料到了只換內容,外框元素與 class 不變(版面不跳動)。實際尺寸由 CSS 的 min-height/定高保證,
// jsdom 量不到像素,這裡斷言的是「外框一定在、class 不因狀態切換」這個結構契約。
// 選擇器一律用 import 的 styles 精確比對(不用 [class*="stopName"] 這類子字串,避免誤中 stopNameXxx 之類的鄰居 class)。
import { describe, it, expect } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { dataSourceFromRefs, renderWithPlanData as render } from '../data/fixtures'
import { PlanTimelineView } from './PlanTimelineView'
import { EMPTY_NODE_STATUS, setNodeStatus, type NodeStatusMap } from './status'
import type { PlanNode, PlanThemeChild, PlanTimeline } from './model'
import styles from './PlanTimelineView.module.css'

const blank = (over: Partial<PlanNode> = {}): PlanNode => ({ id: 's', type: 'stop', ...over })
const full = (over: Partial<PlanNode> = {}): PlanNode =>
  blank({ name: '赤崁樓', time: '10:00', duration: '停留 1h', kind: '景點', desc: '荷蘭時期普羅民遮城遺址', thumbIcon: '🏯', placeId: 'p1', lat: 1, lng: 2, ...over })
const tl = (...nodes: PlanNode[]): PlanTimeline => ({ days: [{ id: 'd', nodes }] })
const loading = setNodeStatus(EMPTY_NODE_STATUS, 's', { loading: true })

function view(timeline: PlanTimeline, nodeStatus?: NodeStatusMap) {
  return (
    <PlanTimelineView
      timeline={timeline}
      isThinking={false}
      emptyStateMessage=""
      selectedStopId={null}
      showJumpPill={false}
      onJumpToLatest={() => {}}
      onPanToStop={() => {}}
      onOpenPhotos={() => {}}
      mountedIdsRef={{ current: new Set(['s', 't']) }}
      nodeStatus={nodeStatus}
    />
  )
}

// q/qa——以 styles 的 class 精確選取(class 名稱來自 CSS module,不會有子字串誤中)。
const q = (root: ParentNode, cls: string) => root.querySelector<HTMLElement>(`.${cls}`)
const qa = (root: ParentNode, sel: string) => root.querySelectorAll<HTMLElement>(sel)
// 狀態骨架(SkeletonBlock)——排除 FramedImage 下載中的掃光層(它也是 data-skeleton="block",但包在 [data-status] 外框裡)。
const statusSkeletons = (root: ParentNode) =>
  Array.from(qa(root, '[data-skeleton="block"]')).filter((el) => !el.closest('[data-status]'))

// frameClasses——卡片外框幾個元素的 className 快照(縮圖、文字區三列);stopDescEmpty 是「沒有描述」的修飾 class,另外斷言。
function frameClasses(root: ParentNode) {
  return {
    card: q(root, styles.stopCard)?.className,
    thumb: q(root, styles.stopThumb)?.className,
    meta: q(root, styles.stopMeta)?.className,
    name: q(root, styles.stopName)?.className,
  }
}

describe('PlanTimelineView 先站位', () => {
  it('查詢中的空白節點:外框齊全,meta/名稱/描述都有站位,不印孤零零的「·」', () => {
    const { container } = render(view(tl(blank()), loading))
    // meta 列的站位:只有「查詢地點中…」標籤(沒有 duration/kind 可串,不印「·」)
    const meta = q(container, styles.stopMeta)!
    expect(meta.textContent).toBe('查詢地點中…')
    expect(meta.children).toHaveLength(1)
    expect(meta.children[0].className).toBe(styles.loadingTag)
    // 名稱一條、描述兩條佔位條,各自帶自己的佔位 class
    const name = q(container, styles.stopName)!
    expect(statusSkeletons(name)).toHaveLength(1)
    expect(statusSkeletons(name)[0].classList.contains(styles.textPlaceholderName)).toBe(true)
    const desc = q(container, styles.stopDesc)!
    expect(desc.classList.contains(styles.stopDescEmpty)).toBe(true)
    expect(statusSkeletons(desc).map((el) => [styles.textPlaceholderDesc, styles.textPlaceholderDescShort].some((c) => el.classList.contains(c)))).toEqual([true, true])
    // 縮圖查詢中:64px 圓形外框內鋪共用骨架(取代原本的轉圈),不是 FramedImage
    const thumb = q(container, styles.stopThumb)!
    expect(statusSkeletons(thumb)).toHaveLength(1)
    expect(thumb.querySelector('[data-status]')).toBeNull()
  })

  it('資料補齊後只換內容:外框元素的 class 不變,佔位條消失', () => {
    const { container, rerender } = render(view(tl(blank()), loading))
    const before = frameClasses(container)
    for (const v of Object.values(before)) expect(v).toEqual(expect.any(String))
    rerender(view(tl(full()), EMPTY_NODE_STATUS))
    expect(frameClasses(container)).toEqual(before)
    expect(statusSkeletons(q(container, styles.stopCard)!)).toHaveLength(0)
    expect(q(container, styles.stopMeta)?.textContent).toBe('停留 1h · 景點')
    expect(q(container, styles.stopDesc)?.textContent).toBe('荷蘭時期普羅民遮城遺址')
  })

  it('查詢失敗、沒有描述:描述區仍佔位(空的站位外框),不畫佔位條', () => {
    const { container } = render(view(tl(full({ desc: undefined })), setNodeStatus(EMPTY_NODE_STATUS, 's', { failed: true })))
    const desc = q(container, styles.stopDesc)
    expect(desc?.classList.contains(styles.stopDescEmpty)).toBe(true)
    expect(desc?.textContent).toBe('')
    expect(statusSkeletons(q(container, styles.stopCard)!)).toHaveLength(0)
  })

  it('沒有照片:縮圖外框照樣渲染(放 thumbIcon);有照片時是同一個外框 class,圖片交給 FramedImage(載入中→載入完成淡入,失敗退回 thumbIcon)', async () => {
    const { container: none } = render(view(tl(full())))
    const noneThumb = q(none, styles.stopThumb)
    expect(noneThumb?.textContent).toBe('🏯')

    const resolved = new Map<string, PlanThemeChild>([['p1', { id: 'p1', placeId: 'p1', googlePhotoUrls: ['https://img/a.jpg'] }]])
    const { container } = render(view(tl(full())), dataSourceFromRefs(resolved))
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(q(container, styles.stopThumb)?.className).toBe(noneThumb?.className)
    const img = container.querySelector('img')!
    const frame = img.closest<HTMLElement>('[data-status]')!
    expect(frame.dataset.status).toBe('loading')
    fireEvent.load(img)
    expect(frame.dataset.status).toBe('loaded')

    // 照片失效:FramedImage 回報 onError → 記入 failedPhotoUrls,整張縮圖退回 thumbIcon 佔位(外框 class 不變)
    const { container: broken } = render(view(tl(full())), dataSourceFromRefs(resolved))
    await waitFor(() => expect(broken.querySelector('img')).not.toBeNull())
    fireEvent.error(broken.querySelector('img')!)
    await waitFor(() => expect(broken.querySelector('img')).toBeNull())
    expect(q(broken, styles.stopThumb)?.textContent).toBe('🏯')
    expect(q(broken, styles.stopThumb)?.className).toBe(noneThumb?.className)
  })

  it('交通查詢中:膠囊內是小轉圈+佔位條(不是只剩一顆轉圈),查完後膠囊 class 不變', () => {
    const transitLoading = { loading: true }
    const transitDone = { mode: '步行', minutes: 8, distance: '621m' }
    const prev = full({ id: 'p' })
    const { container, rerender } = render(view(tl(prev, full({ id: 't', transitFromPrev: transitLoading }))))
    const pill = q(container, styles.transitPill)!
    expect(pill.querySelector('[aria-label="查詢交通資訊中"]')).not.toBeNull()
    expect(q(pill, styles.transitTextPlaceholder)).not.toBeNull()
    const pillClass = pill.className
    rerender(view(tl(prev, full({ id: 't', transitFromPrev: transitDone }))))
    const after = q(container, styles.transitPill)!
    expect(after.className).toBe(pillClass)
    expect(after.textContent).toBe('步行 8 分 · 621m')
    expect(q(after, styles.transitTextPlaceholder)).toBeNull()
  })
})
