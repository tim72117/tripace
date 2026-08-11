import { useEffect, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { PublicLinkViewMode } from './api'
import * as api from './api'
import type { Entry } from './types'
import { MultiTrackTimeline } from './Timeline'
import { BASE_URL, errMsg, useIsDesktop } from './AppCommon'
import { PaceChart, type Checkpoint, type PaceCheckpointDetail } from './PaceChart'
import { PaceRouteMap } from './PaceRouteMap'
import { PacePhoneSwipe } from './PacePhoneSwipe'

// PhoneScreens:手機版公開分享頁(PublicViewScreen)——從 App.tsx 拆出來。
// 設定頁(SettingsScreen)已經拆成獨立的 SettingsScreen.tsx,不再放這裡
// (原本的 TripsScreen 行程列表也已改為 PhoneNavDrawer.tsx 的行程列表
// 分頁,不再是整頁元件)。

// ---- 配速表模式的檢查站資料形狀 ----
// 對應後端 Entry.detail 這個自訂 JSON 欄位裡,配速表專屬會用到的子集——
// 權威定義是 PaceChart.tsx 匯出的 PaceCheckpointDetail(對齊後端
// server/internal/model/entry_detail_pace.go),這裡直接引用,不再自己
// 維護一份容易不同步的複本。Entry 型別本身(types.ts)沒有宣告 detail,
// 是後端這個欄位對其他 kind 沒有固定 schema,故仍需要執行期防呆判斷,
// 不假設任何一筆地點一定有這個形狀。
function entryPaceDetail(e: Entry): PaceCheckpointDetail | null {
  const d = (e as unknown as { detail?: unknown }).detail
  if (!d || typeof d !== 'object') return null
  const detail = d as Partial<PaceCheckpointDetail>
  if (typeof detail.segment !== 'string' || typeof detail.order !== 'number') return null
  return detail as PaceCheckpointDetail
}

// hasPaceData:分享彈窗選了「路徑」時,公開頁要判斷這個行程的地點是否
// 真的帶有路徑用的 detail 結構——這是額外用 CLI/entry-update 手動標註
// 的資料,不是分享彈窗本身能自動產生的,沒有這類資料時要顯示提示訊息,
// 而不是渲染一個空的抽屜欄假裝正常。
function hasPaceData(entries: Entry[]): boolean {
  return entries.some((e) => entryPaceDetail(e) !== null)
}

// PublicPaceDrawerMap:路徑模式下的呈現——套用跟登入後正式介面/`/demo/pace`
// 示範頁相同的「左側抽屜欄(PaceChart 檢查站清單)+ 主顯示區地圖
// (PaceRouteMap)」結構(PacePhoneSwipe.tsx 手機寬度、桌面寬度則側欄+主區
// 並排,比照 PublicPaceDemoPage.tsx 的桌面分支),取代原本精簡的卡片清單
// (PublicPaceList,已移除)——這裡不帶上方功能列(navbar),因為
// PublicViewScreen 本身已經有自己的 navbar(行程名稱標題),不需要疊兩層。
// checkpoints 狀態提升到這裡,理由同 DesktopLayout.tsx/PhoneContent.tsx:
// PaceChart(抽屜/側欄)與 PaceRouteMap(地圖)是分開掛載的 sibling,靠
// PaceChart 的 onRouteChange 把目前選取的段落鏡像上來再轉傳給地圖。
// publicToken 直接傳這個分享頁自己的 token(見 PaceChart.tsx 的 publicToken
// prop 說明),不是 /demo/pace 那個寫死的展示行程 token。
function PublicPaceDrawerMap({ token }: { token: string }) {
  const isDesktop = useIsDesktop()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  if (!isDesktop) {
    return <PacePhoneSwipe publicToken={token} checkpoints={checkpoints} onRouteChange={setCheckpoints} />
  }
  return (
    <div className="desktop-layout">
      <aside className="desktop-sidepanel wide">
        <div className="desktop-sidepanel-inner">
          <div className="desktop-sidepanel-pace">
            <PaceChart publicToken={token} onRouteChange={setCheckpoints} />
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        <div className="desktop-demo-panel">
          <PaceRouteMap checkpoints={checkpoints} publicToken={token} />
        </div>
      </main>
    </div>
  )
}

// ---- 公開分享頁（/public/{token}，無需登入） ----

export function PublicViewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ tripID: string; tripName: string; editable: boolean; viewMode: PublicLinkViewMode; entries: Entry[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const bodyRef = useRef<HTMLDivElement>(null)

  const resolvedBase = BASE_URL

  useEffect(() => {
    api.fetchPublicView(resolvedBase, token)
      .then(setData)
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false))
  }, [resolvedBase, token])

  useEffect(() => {
    if (data?.tripName) document.title = data.tripName
    return () => { document.title = 'Tripace' }
  }, [data?.tripName])

  useEffect(() => {
    if (data && todayRef.current && bodyRef.current) {
      bodyRef.current.scrollTo({ top: todayRef.current.offsetTop - 60, behavior: 'instant' })
    }
  }, [data])

  // 路徑模式且真的有路徑資料時,改用抽屜欄+地圖的滿版結構(見
  // PublicPaceDrawerMap 的說明)——那套結構自己已經佔滿整個畫面(比照
  // PacePhoneSwipe.tsx/DesktopLayout.tsx 的定位方式),不需要再包一層這裡
  // 的 .navbar/.screen-body,也不會有新增行程的輸入列(路徑模式不接寫入
  // 互動,理由同時間軸模式以外的其餘邏輯不變)。
  if (data && data.entries.length > 0 && data.viewMode === 'pace' && hasPaceData(data.entries)) {
    return <PublicPaceDrawerMap token={token} />
  }

  return (
    <>
      <div className="navbar">
        <span style={{ width: 36 }} />
        <span className="title">{data?.tripName ?? '行程'}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body" ref={bodyRef}>
        {loading && <div className="empty">載入中…</div>}
        {err && <div className="banner"><AlertCircle size={14} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 6 }} />{err}</div>}
        {data && (
          data.entries.length === 0
            ? <div className="empty">此行程尚無內容。</div>
            : data.viewMode === 'pace'
              // 分享者選了「路徑」,但這個行程的地點沒有路徑需要的 detail
              // 結構(那是額外用 CLI/entry-update 手動標註的資料,分享彈窗
              // 本身不會自動產生)——顯示明確提示,不要求訪客自己猜「怎麼
              // 是空的」,也不要靜默退回時間軸掩蓋掉分享者原本的選擇。
              ? <div className="empty">此行程尚無路徑資料。</div>
              : <MultiTrackTimeline entries={data.entries} todayRef={todayRef} />
        )}
      </div>
    </>
  )
}
