import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { Entry } from '../types'
import { MultiTrackTimeline } from '../timeline/Timeline'
import { BASE_URL, errMsg } from '../AppCommon'
import { ScrollArea } from '../components/ScrollArea'
import { Banner } from '../components/Banner'
import { Navbar } from '../components/Navbar'

// PublicViewScreen:手機版公開分享頁——從 App.tsx 拆出來,原檔名
// PhoneScreens.tsx(當時裝多個畫面),設定頁/旅程列表陸續拆成獨立檔案
// (SettingsScreen.tsx/PhoneNavDrawer.tsx)後只剩這一個,改名對齊實際內容
// 並歸進 trip/(分享連結是旅程底下的功能)。

// ---- 公開分享頁（/public/{token}，無需登入） ----

export function PublicViewScreen({ token }: { token: string }) {
  const [data, setData] = useState<{ tripID: string; tripName: string; editable: boolean; entries: Entry[] } | null>(null)
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

  return (
    <>
      <Navbar title={data?.tripName ?? '旅程'} />
      <ScrollArea ref={bodyRef}>
        {loading && <div className="empty">載入中…</div>}
        <Banner message={err} icon />
        {data && (
          data.entries.length === 0
            ? <div className="empty">此旅程尚無內容。</div>
            : <MultiTrackTimeline entries={data.entries} todayRef={todayRef} />
        )}
      </ScrollArea>
    </>
  )
}
