import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ChevronDown, ChevronRight, MapPin, ClipboardList, Trash2 } from 'lucide-react'
import type { AssistPlace, PresentedEntry } from './api'
import { ASSISTANT_ID, ENTRY_QUERY_BATCH_KEY, type ChatMessage } from './chatTypes'
import { RecommendedPlacesList, type RecommendedPlace } from './RecommendedPlaces'
import type { TripBatches, TripEntry } from './clienttools/tripEntryTools'

export function MessageBubble({
  msg,
  meID,
  tripBatches,
  isLatest,
  onDeleteTripBatchEntries,
}: {
  msg: ChatMessage
  meID: string
  // tripBatches:目前最新的所有批次(clientToolsBatches state,由 ChatScreen
  // 傳入)。msg.tripListTriggered 是這則訊息觸發時具體變化的 key 清單(可能
  // 不只一個),底下依序渲染這些 key 各自「當下最新」的清單——不是這則訊息
  // 自己存的快照,故同一時刻若有多則訊息都帶同一個 key,會重複顯示同一份
  // 最新清單好幾次(預期行為)。非 triggered 訊息不需要這個 prop 的內容,但
  // 仍會收到(呼叫端一律傳入,不額外判斷)。
  tripBatches: TripBatches
  // isLatest:這則訊息是不是這次「即時產生」的最新一則答案(ChatScreen 用
  // m.id === latestAnswerID 算出,見該處說明)。傳給 AttachmentsPanel 決定
  // 附加資料區塊(推薦景點/旅程清單)預設展開或收合。
  isLatest: boolean
  // onDeleteTripBatchEntries:TripListTable 勾選項目後按刪除時呼叫,見
  // ChatScreen 的 deleteTripBatchEntries 說明。一路往下傳給 AttachmentsPanel
  // → TripListTable。
  onDeleteTripBatchEntries: (key: string, ids: Set<string>) => void
}) {
  // 新模型:message 只剩原話,LLM 標注已移至 entry(在上方事件列表顯示)。
  const mine = msg.authorID === meID
  // 只有助理「回答」訊息用 Markdown 渲染;使用者輸入/記事訊息維持純文字。
  const isAnswer = msg.authorID === ASSISTANT_ID
  // LLM 回答輸出文字時(非 pending 狀態)不套用泡泡外觀,直接呈現純文字;
  // pending 狀態仍要維持泡泡(WaveLoader 海浪動畫依賴卡片背景/內距呈現,
  // 拿掉會讓動畫裸露在對話流裡)。使用者自己的訊息(mine)不受影響。
  const bare = isAnswer && !msg.pending
  return (
    <div className={`bubble-group ${mine ? 'mine' : ''}`} data-msg-id={msg.id}>
      <div className={`bubble ${mine ? 'mine' : ''} ${msg.pending ? 'pending' : ''} ${bare ? 'bare' : ''}`}>
        {/* 助手回答泡泡不顯示作者名(不出現「助手」);對齊 iOS MessageRow */}
        {!mine && !isAnswer && msg.authorName && (
          <div className="sub" style={{ marginBottom: 2 }}>
            {msg.authorName}
          </div>
        )}
        {msg.pending ? (
          // 後端處理中:海浪載入動畫(色塊群組依序起伏)。
          <WaveLoader />
        ) : isAnswer ? (
          <div className="text markdown">
            <ReactMarkdown>{msg.text}</ReactMarkdown>
          </div>
        ) : (
          <div className="text">{msg.text}</div>
        )}
      </div>
      {/* agent 用 present_entries 輸出的條目,在答案泡泡下用列表顯示。
          present_entries 的查詢結果條列不在「推薦景點+旅程清單合併成折疊
          按鈕」的範圍內,維持原樣獨立顯示(不收進 AttachmentsPanel)。*/}
      {msg.presented?.map((e, i) => (
        <PresentedCard key={`p${i}`} entry={e} />
      ))}
      {/* 推薦景點(recommend_nearby)+ 旅程清單(entry_query/trip_entry_add/
          trip_entry_update 觸發的 tripListTriggered)合併成一個可展開/收合的
          區塊,見 AttachmentsPanel 的說明。*/}
      <AttachmentsPanel
        isLatest={isLatest}
        recommendedPlaces={msg.recommendedPlaces}
        tripListTriggered={msg.tripListTriggered}
        tripBatches={tripBatches}
        onDeleteTripBatchEntries={onDeleteTripBatchEntries}
      />
    </div>
  )
}

// AttachmentsPanel:推薦景點(recommendedPlaces)+ 旅程清單(tripListTriggered)
// 合併成一個可展開/收合的區塊,收合成一顆按鈕。只有「這次即時產生」的最新
// 一則答案(isLatest)預設展開,其餘(含重新整理頁面後讀回的所有歷史訊息)
// 一律預設收合,使用者點按鈕才展開——見 ChatScreen 上層 send()/load() 對
// isLatest 判斷方式的說明。展開狀態是這個元件自己的 local state(不回寫到
// ChatMessage/裝置端 DB),重新整理頁面後一律重置回收合。
function AttachmentsPanel({
  isLatest,
  recommendedPlaces,
  tripListTriggered,
  tripBatches,
  onDeleteTripBatchEntries,
}: {
  isLatest: boolean
  recommendedPlaces?: AssistPlace[]
  tripListTriggered?: string[]
  tripBatches: TripBatches
  onDeleteTripBatchEntries: (key: string, ids: Set<string>) => void
}) {
  const [open, setOpen] = useState(isLatest)
  const hasPlaces = !!recommendedPlaces && recommendedPlaces.length > 0
  const hasList = !!tripListTriggered && tripListTriggered.length > 0
  if (!hasPlaces && !hasList) return null
  return (
    <div style={{ margin: '8px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border, #33333322)', background: 'var(--surface, #00000008)',
          fontSize: 13, cursor: 'pointer', color: 'inherit',
        }}
      >
        {open ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronRight size={14} strokeWidth={1.8} />}
        {hasPlaces && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={14} strokeWidth={1.8} />
            推薦景點 x{recommendedPlaces!.length}
          </span>
        )}
        {hasList && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ClipboardList size={14} strokeWidth={1.8} />
            旅程清單 x{tripListTriggered!.length}
          </span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 4 }}>
          {hasPlaces && <RecommendedPlacesList places={recommendedPlaces!.map(toRecommendedPlace)} />}
          {hasList && tripListTriggered!.map((key) => (
            <TripListTable
              key={key}
              batchKey={key}
              entries={tripBatches[key] ?? []}
              onDelete={(ids) => onDeleteTripBatchEntries(key, ids)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// TripListTable:單一批次(key)的旅程清單表格顯示(標題/日期/時刻/備註
// 四欄),抄自先前固定在頂端的旅程清單面板(已移除),視覺不重新設計。掛在
// 觸發 entry_query/trip_entry_add/trip_entry_update 的訊息底下(見
// MessageBubble)。標題帶上 batchKey,讓使用者看得出這是哪一批——多批次
// (key)支援後,同一則訊息底下可能同時顯示好幾個批次的表格,不帶 key 會
// 分不清楚哪張表對應哪一批。ENTRY_QUERY_BATCH_KEY 這個內部保留 key 顯示成
// 「查詢結果」而非原始字串,避免使用者看到底線開頭的內部識別碼。
// onDelete:選取項目按刪除鈕時呼叫,帶上被勾選的 entry id 集合(見
// ChatScreen 的 deleteTripBatchEntries)。選取狀態(selected)是這個元件自己
// 的 local state,不回寫到任何持久化資料——純粹是「這次操作要刪哪幾筆」的
// 暫時 UI 狀態,刪除送出後或 entries 換一批新內容時自然重置。
function TripListTable({
  batchKey,
  entries,
  onDelete,
}: {
  batchKey: string
  entries: TripEntry[]
  onDelete: (ids: Set<string>) => void
}) {
  const label = batchKey === ENTRY_QUERY_BATCH_KEY ? '查詢結果' : batchKey
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allSelected = entries.length > 0 && selected.size === entries.length
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)))
  }
  const handleDelete = () => {
    onDelete(selected)
    setSelected(new Set())
  }
  return (
    <div style={{
      margin: '8px 0', padding: '10px 12px', borderRadius: 10,
      border: '1px solid var(--border, #33333322)', background: 'var(--surface, #00000008)',
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ opacity: 0.6, fontSize: 12 }}>批次:{label}</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={handleDelete}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6,
              border: '1px solid var(--danger, #c0392b)', background: 'transparent',
              color: 'var(--danger, #c0392b)', fontSize: 12, cursor: 'pointer',
            }}
          >
            <Trash2 size={12} strokeWidth={1.8} />
            刪除({selected.size})
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <div style={{ opacity: 0.6 }}>目前這批清單是空的(LLM 呼叫 trip_entry_add 後會顯示在這裡)。</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th style={{ fontWeight: 400, padding: '6px 16px 6px 0', width: 20 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th style={{ fontWeight: 400, padding: '6px 16px 6px 0' }}>標題</th>
              <th style={{ fontWeight: 400, padding: '6px 16px 6px 0' }}>日期</th>
              <th style={{ fontWeight: 400, padding: '6px 16px 6px 0' }}>時刻</th>
              <th style={{ fontWeight: 400, padding: '6px 0' }}>備註</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} onClick={() => toggle(e.id)} style={{ cursor: 'pointer' }}>
                <td style={{ padding: '6px 16px 6px 0' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                </td>
                <td style={{ padding: '6px 16px 6px 0' }}>{e.title}</td>
                <td style={{ padding: '6px 16px 6px 0' }}>{e.date}</td>
                <td style={{ padding: '6px 16px 6px 0' }}>{e.time}</td>
                <td style={{ padding: '6px 0' }}>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// toRecommendedPlace 把後端回傳的 AssistPlace(name/address/lat/lng/primaryType)
// 補上 RecommendedPlacesList 需要的 rating/userRatingCount 欄位(目前後端尚未提供
// 評分資料,補 0 讓 RatingStars 顯示「尚無評分」;photoUrl/summary 留空,同樣由
// RecommendedPlaceCard 既有的空狀態處理呈現)。
function toRecommendedPlace(p: AssistPlace): RecommendedPlace {
  return {
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    rating: 0,
    userRatingCount: 0,
    primaryType: p.primaryType,
  }
}

// WaveLoader:後端處理中的海浪載入動畫。
// 多個色塊依序上下起伏(animation-delay 漸進),整體像海浪由左而右流動。
function WaveLoader() {
  const bars = 5
  return (
    <div className="wave" aria-label="處理中" role="status">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  )
}

// PresentedCard 顯示 present_entries 輸出的條目(查詢結果列表用)。
function PresentedCard({ entry }: { entry: PresentedEntry }) {
  const allDay = !entry.startTime
  const when = entry.start
    ? allDay ? entry.start : `${entry.start} ${entry.startTime}`
    : '未指定時間'
  const endLabel = entry.end
    ? entry.endTime ? ` ~ ${entry.end} ${entry.endTime}` : ` ~ ${entry.end}`
    : ''
  return (
    <div className="entry-card">
      <span className="entry-ico">📅</span>
      <div className="entry-body">
        <div className="entry-item">{entry.title}</div>
        <div className="entry-when">{when}{endLabel}</div>
      </div>
    </div>
  )
}
