import { useEffect, useState } from 'react'
import { api, getToken, type AdPlan, type Campaign, type Partner, type Placement } from './api'
import Select from './Select'
import DateInput from './DateInput'

const CAMPAIGN_STATUS_OPTIONS = ['draft', 'scheduled', 'active', 'paused', 'ended'].map((s) => ({ value: s, label: s }))
const UNSET_PLACEMENT_OPTION = { value: '', label: '（尚未指定）' }

// usePlacements——取代原先寫死在這個檔案裡的 PLACEMENT_OPTIONS 清單
// (2026-10 改動),改成打 GET /partner/api/placements 查詢後端唯一一份
// 清單來源(見 partnerconsole.validPlacements 的完整說明)。載入中/查詢
// 失敗時回傳空陣列——呼叫端(下拉選單)在這兩種狀況下只會顯示「尚未
// 指定」這個固定選項,不會整個畫面壞掉。
function usePlacements(): Placement[] {
  const [placements, setPlacements] = useState<Placement[]>([])
  useEffect(() => {
    api
      .listPlacements()
      .then((res) => setPlacements(res.placements))
      .catch(() => {
        // 查詢失敗就留空清單,不擋住其他功能(見本函式的完整說明)。
      })
  }, [])
  return placements
}

// App——業主控制台骨架。目前只有「活動」「方案內容」兩個分頁是真正可用
// 的,「儀表板」先留空白佔位頁(見本次需求:先建架構,之後再加儀表板)。
// 登入狀態單純靠 localStorage 有沒有 token 判斷(比照 web/admin 的既有
// 模式),沒有 token 時顯示登入/註冊畫面,有 token 時先打 /partner/api/me
// 驗證 token 是否仍有效(過期/被撤銷的 token 在這裡會被擋下,退回登入
// 畫面,不會讓使用者卡在一個打什麼 API 都 401 的空殼畫面)。
export default function App() {
  const [partner, setPartner] = useState<Partner | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setCheckingSession(false)
      return
    }
    api
      .me()
      .then(setPartner)
      .catch(() => {
        // token 失效,留在登入畫面,不特別提示錯誤訊息(使用者只會看到
        // 登入表單,跟從未登入過的體感一致)。
      })
      .finally(() => setCheckingSession(false))
  }, [])

  if (checkingSession) {
    return (
      <div className="app-shell">
        <p className="empty-state">載入中…</p>
      </div>
    )
  }

  if (!partner) {
    return <AuthScreen onAuthed={setPartner} />
  }

  return <Console partner={partner} onLogout={() => setPartner(null)} />
}

// --- 登入 ---------------------------------------------------------------
//
// 沒有「註冊」分頁——這裡登入的是一般 Tripace 帳號(比照 web/admin 的
// 既有模式,見 api.ts login 的完整說明),帳號本身要先在主站 /app 或
// 行動裝置 App 註冊好。這個畫面只負責登入,「這個帳號有沒有業主權限」
// 是登入成功後由後端 /partner/api/me 決定,不是這裡能控制的事——目前
// 沒有自助申請業主身分的流程(2026-10 明確決定延後),只能由內部人員
// 手動開通。

function AuthScreen({ onAuthed }: { onAuthed: (p: Partner) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const p = await api.login(email, password)
      onAuthed(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生未預期的錯誤')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell" style={{ maxWidth: 400 }}>
      <h1>業主控制台</h1>
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          使用你的 Tripace 帳號登入。若尚未擁有業主權限，請聯絡內部窗口開通。
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="partner-email">Email</label>
            <input
              id="partner-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="partner-password">密碼</label>
            <input
              id="partner-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  )
}

// --- 主控台 --------------------------------------------------------------

type Tab = 'campaigns' | 'dashboard'

function Console({ partner, onLogout }: { partner: Partner; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('campaigns')

  return (
    <div className="app-shell">
      <div className="app-header">
        <h1 style={{ marginBottom: 0 }}>業主控制台</h1>
        <div className="partner-badge">
          {partner.name}
          <button
            className="secondary"
            style={{ marginLeft: '0.75rem' }}
            onClick={() => {
              api.logout()
              onLogout()
            }}
          >
            登出
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')} type="button">
          廣告活動
        </button>
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')} type="button">
          儀表板
        </button>
      </div>

      {tab === 'campaigns' ? <CampaignsPanel /> : <DashboardPanel />}
    </div>
  )
}

// --- 廣告活動 --------------------------------------------------------------
//
// 2026-10 補上「點活動進去看細節」——原本的列表只顯示名稱/檔期/狀態,
// 整行是個靜態 <div>,沒有任何可以點擊深入的路徑,底下的方案(plan)
// 列表在前端完全沒有入口(API client 早就有 listAdPlans/createAdPlan
// 等方法,只是沒有畫面呼叫它們)。改成 selectedCampaignID 控制「列表」
// 與「活動詳情(含方案列表)」兩個檢視互斥切換,比照一般 list→detail
// 的既有慣例(對齊 docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md
// 第 3 節提到的同一種模式,雖然那份文件是給贊助模式的 admin 介面規劃,
// 但 list→detail 這個形狀是通用的)。

function CampaignsPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedCampaignID, setSelectedCampaignID] = useState<string | null>(null)

  function reload() {
    api
      .listCampaigns()
      .then((r) => setCampaigns(r.campaigns))
      .catch((err) => setError(err instanceof Error ? err.message : '載入失敗'))
  }

  useEffect(reload, [])

  if (selectedCampaignID) {
    return (
      <CampaignDetail
        campaignID={selectedCampaignID}
        onBack={() => {
          setSelectedCampaignID(null)
          reload() // 回列表時重新整理——詳情頁內可能改了活動狀態
        }}
      />
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ marginBottom: 0 }}>廣告活動</h2>
        <button onClick={() => setShowCreate((v) => !v)} type="button">
          {showCreate ? '取消' : '+ 新增活動'}
        </button>
      </div>

      {showCreate && (
        <CreateCampaignForm
          onCreated={() => {
            setShowCreate(false)
            reload()
          }}
        />
      )}

      {error && <p className="error-text">{error}</p>}

      {campaigns === null ? (
        <p className="empty-state">載入中…</p>
      ) : campaigns.length === 0 ? (
        <p className="empty-state">還沒有任何活動，點右上角「+ 新增活動」建立第一個</p>
      ) : (
        <div className="row-list">
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              className="row-item row-item-clickable"
              onClick={() => setSelectedCampaignID(c.id)}
            >
              <div>
                <div className="row-title">{c.name}</div>
                <div className="row-sub">
                  {c.startDate || '未設定開始日'} — {c.endDate || '未設定結束日'}
                </div>
              </div>
              <span className="status-pill" data-status={c.status}>{c.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// CampaignDetail——活動詳情:基本資料 + 狀態切換 + 底下的方案列表/新增。
function CampaignDetail({ campaignID, onBack }: { campaignID: string; onBack: () => void }) {
  const placements = usePlacements()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [plans, setPlans] = useState<AdPlan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreatePlan, setShowCreatePlan] = useState(false)
  const [statusSubmitting, setStatusSubmitting] = useState(false)

  function reload() {
    api
      .listAdPlans(campaignID)
      .then((r) => setPlans(r.plans))
      .catch((err) => setError(err instanceof Error ? err.message : '載入方案失敗'))
  }

  useEffect(() => {
    // 目前沒有單獨的「取得單一活動」API client 方法(見 api.ts 的
    // listCampaigns),用列表結果裡找同一筆——活動數量目前不多,這個
    // O(n) 查找成本可忽略;若之後活動數量變大,應改呼叫專屬的
    // GET /partner/api/campaigns/{id} 端點(後端已經有,只是前端
    // client 還沒補對應方法)。
    api
      .listCampaigns()
      .then((r) => {
        const found = r.campaigns.find((c) => c.id === campaignID)
        setCampaign(found ?? null)
        if (!found) setError('找不到這個活動')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '載入活動失敗'))
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignID])

  async function handleStatusChange(status: string) {
    setStatusSubmitting(true)
    setError(null)
    try {
      const updated = await api.setCampaignStatus(campaignID, status)
      setCampaign(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新狀態失敗')
    } finally {
      setStatusSubmitting(false)
    }
  }

  async function handlePlacementChange(placement: string) {
    if (!campaign) return
    setStatusSubmitting(true)
    setError(null)
    try {
      const updated = await api.updateCampaign(campaignID, {
        name: campaign.name,
        placement,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
      })
      setCampaign(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新投放頁面失敗')
    } finally {
      setStatusSubmitting(false)
    }
  }

  const placementLabel =
    placements.find((opt) => opt.value === (campaign?.placement ?? ''))?.label ?? '（尚未指定）'

  return (
    <div className="card">
      <button className="back-link" type="button" onClick={onBack}>
        ← 返回活動列表
      </button>

      {error && <p className="error-text">{error}</p>}

      {campaign === null ? (
        <p className="loading-state">載入中…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', marginBottom: '0.3rem' }}>{campaign.name}</h2>
              <div className="row-sub">
                {campaign.startDate || '未設定開始日'} — {campaign.endDate || '未設定結束日'}
              </div>
            </div>
            <Select
              className="status-select"
              value={campaign.status}
              disabled={statusSubmitting}
              onChange={handleStatusChange}
              ariaLabel="活動狀態"
              options={CAMPAIGN_STATUS_OPTIONS}
            />
          </div>

          <div className="field" style={{ maxWidth: '20rem' }}>
            <label htmlFor="campaign-detail-placement" id="campaign-detail-placement-label">
              投放頁面
            </label>
            <Select
              id="campaign-detail-placement"
              labelId="campaign-detail-placement-label"
              value={campaign.placement ?? ''}
              disabled={statusSubmitting}
              onChange={handlePlacementChange}
              options={[UNSET_PLACEMENT_OPTION, ...placements]}
            />
            {campaign.status === 'active' && campaign.placement && (
              <p className="row-sub" style={{ marginTop: '0.3rem' }}>
                已發布的方案現在會顯示在「{placementLabel}」頁面上
              </p>
            )}
          </div>

          <div className="card-head" style={{ marginTop: '1.5rem' }}>
            <h2>方案內容</h2>
            <button onClick={() => setShowCreatePlan((v) => !v)} type="button">
              {showCreatePlan ? '取消' : '+ 新增方案'}
            </button>
          </div>

          {showCreatePlan && (
            <CreateAdPlanForm
              campaignID={campaignID}
              onCreated={() => {
                setShowCreatePlan(false)
                reload()
              }}
            />
          )}

          {plans === null ? (
            <p className="empty-state">載入中…</p>
          ) : plans.length === 0 ? (
            <p className="empty-state">這個活動還沒有任何方案，點上方「+ 新增方案」建立第一個</p>
          ) : (
            plans.map((p) => <AdPlanRow key={p.id} plan={p} onChanged={reload} />)
          )}
        </>
      )}
    </div>
  )
}

// PlanDetail——方案細節的結構化形狀(2026-10 新增並擴充,對齊使用者
// 分享的真實旅行社團體行程卡片截圖)。業主不直接編輯 detail 這個
// JSON 字串本身——表單收集這幾個具名欄位,送出前在前端組成 JSON
// (見 serializePlanDetail),列表顯示時解析回來渲染(見
// parsePlanDetail)。之所以不讓業主碰原始 JSON:這是對外部第三方
// 開放的介面,原始 JSON textarea 既不好填也容易填出格式錯誤或欄位
// 打錯字的內容,具名欄位才符合這個使用者角色的操作期待。
//
// departures(2026-10 第二輪擴充,見使用者分享的第二張截圖)——
// 同一條行程(例如「九州湯布院 別府溫泉 4日」)真實情況下會有多個
// 出發日梯次,各自獨立報價(旺季/平日/連假價格不同)。原本的單一
// departureDate+price 欄位無法表達這種一對多關係,改成陣列——這跟
// highlights 刻意維持單一 textarea(填寫頻率低、不需要逐列編輯)的
// 判斷不同:梯次是這個方案最核心、業主會頻繁增刪調整的資料,值得
// 做成可新增/刪除列的動態表單(見下方 DepartureRow)。
//
// Departure.price 刻意存成字串而非數字——這裡只是單純文字輸入框,
// 不做千分位/幣別格式化,避免過度設計;真要做價格格式化應該是之後
// 的強化項目。
interface Departure {
  date: string
  weekday: string
  price: string
}

interface PlanDetail {
  departures: Departure[]
  days: string
  originalPrice: string
  highlights: string // 多行文字,換行即分隔
  desc: string
  ctaLabel: string
  landingUrl: string
  fromPrice: string // KKday 方案的參考價,前台顯示為價格錨點
  cid: string // KKday 聯盟代碼(category 為 kkday 時必填,後端會寫進 landingUrl)
}

// 方案分類。kkday 是聯盟連結方案:業主填自己的 cid 與 kkday.com 商品頁網址,
// 後端檢查網域並把 cid 寫進連結(見 server/internal/adlink),前台用同一張
// SponsoredPlanCard 顯示。
const KKDAY_CATEGORY = 'kkday'
const CATEGORY_OPTIONS = [
  { value: '', label: '（未分類）' },
  { value: 'group_tour', label: '旅行社團體行程' },
  { value: KKDAY_CATEGORY, label: 'KKday 聯盟連結' },
]

function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? (category || '未分類')
}

function emptyPlanDetail(): PlanDetail {
  return {
    departures: [],
    days: '',
    originalPrice: '',
    highlights: '',
    desc: '',
    ctaLabel: '',
    landingUrl: '',
    cid: '',
    fromPrice: '',
  }
}

// parsePlanDetail 容錯解析——detail 可能是空字串、"{}"、或格式不明的
// 舊資料(例如之前用 partner-cli -detail 直接塞的任意 JSON,或擴充
// 欄位前建立的舊方案,含改成 departures 陣列之前、用單一
// departureDate/price 欄位存的方案),解析失敗或缺欄位一律退回空值,
// 不讓顯示路徑因為一筆資料格式異常而整頁崩潰(對齊 content_pages.go
// extractContentPageTitle「解析失敗不中斷」的既有慣例,但這裡是純
// 前端顯示層,沒有該函式在資料庫寫入路徑上討論過的風險)。
//
// 相容舊格式:若 JSON 裡有舊版的 departureDate/price 欄位(陣列化
// 之前建立的方案)但沒有 departures 陣列,轉換成只有一筆梯次的陣列
// ——既有方案不會因為這次結構調整而顯示空白。
function parsePlanDetail(raw: string): PlanDetail {
  const empty = emptyPlanDetail()
  if (!raw) return empty
  try {
    const obj = JSON.parse(raw) as Partial<PlanDetail> & {
      departureDate?: string
      departureWeekday?: string
      price?: string
    }
    let departures = Array.isArray(obj.departures) ? obj.departures : []
    if (departures.length === 0 && (obj.departureDate || obj.price)) {
      departures = [{ date: obj.departureDate ?? '', weekday: obj.departureWeekday ?? '', price: String(obj.price ?? '') }]
    }
    return {
      departures: departures.map((d) => ({ date: d.date ?? '', weekday: d.weekday ?? '', price: String(d.price ?? '') })),
      days: obj.days ?? '',
      originalPrice: obj.originalPrice ?? '',
      highlights: obj.highlights ?? '',
      desc: obj.desc ?? '',
      ctaLabel: obj.ctaLabel ?? '',
      landingUrl: obj.landingUrl ?? '',
      cid: obj.cid ?? '',
      fromPrice: obj.fromPrice ?? '',
    }
  } catch {
    return empty
  }
}

function serializePlanDetail(detail: PlanDetail): string {
  return JSON.stringify(detail)
}

function planDetailHasContent(detail: PlanDetail): boolean {
  return (
    detail.departures.length > 0 ||
    detail.days !== '' ||
    detail.originalPrice !== '' ||
    detail.highlights !== '' ||
    detail.desc !== '' ||
    detail.ctaLabel !== '' ||
    detail.landingUrl !== '' ||
    detail.cid !== '' ||
    detail.fromPrice !== ''
  )
}

// safeHttpUrl——預覽用的連結只放行 http(s),避免 javascript: 等協定在後台頁面點擊時執行
// (後端寫入時也會擋,見 server adlink.CheckLandingURL;這裡處理舊資料與直接改庫的情況)。
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

function AdPlanRow({ plan, onChanged }: { plan: AdPlan; onChanged: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const detail = parsePlanDetail(plan.detail)
  const hasDetail = planDetailHasContent(detail)
  const safeUrl = safeHttpUrl(detail.landingUrl)
  const highlightLines = detail.highlights.split('\n').map((l) => l.trim()).filter(Boolean)

  async function toggleStatus() {
    setSubmitting(true)
    setError(null)
    try {
      await api.setAdPlanStatus(plan.id, plan.status === 'published' ? 'draft' : 'published')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新狀態失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <button
          type="button"
          className="back-link"
          style={{ marginBottom: 0, fontWeight: 400 }}
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasDetail}
          aria-expanded={expanded}
        >
          <span
            aria-hidden="true"
            style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s ease' }}
          >
            ▸
          </span>
          <span>
            <span className="row-title">{plan.title}</span>
            <span className="row-sub" style={{ marginLeft: '0.5rem', display: 'inline' }}>
              {categoryLabel(plan.category)}
            </span>
          </span>
        </button>
        <div className="row-actions">
          <span className="status-pill" data-status={plan.status}>
            {plan.status}
          </span>
          <button className="secondary" type="button" disabled={submitting} onClick={toggleStatus}>
            {plan.status === 'published' ? '改為草稿' : '發布'}
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {expanded && hasDetail && (
        <div className="plan-detail">
          {detail.departures.length > 0 && (
            <div className="plan-departures">
              {detail.days && <div className="plan-days-badge">{detail.days} 天行程</div>}
              <div className="plan-departures-grid">
                {detail.departures.map((dep, i) => (
                  <div className="plan-departure-chip" key={i}>
                    <span className="plan-departure-date">
                      {dep.date}
                      {dep.weekday && <span className="plan-departure-weekday">（{dep.weekday}）</span>}
                    </span>
                    <span className="plan-departure-price">{dep.price}</span>
                  </div>
                ))}
              </div>
              {detail.originalPrice && <div className="row-sub">原價 {detail.originalPrice}</div>}
            </div>
          )}

          {detail.desc && <p className="plan-desc">{detail.desc}</p>}

          {highlightLines.length > 0 && (
            <ul className="plan-highlights">
              {highlightLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}

          {(detail.ctaLabel || detail.landingUrl) && (
            <div className="plan-cta-row">
              {safeUrl ? (
                <a className="plan-cta-link" href={safeUrl} target="_blank" rel="noopener noreferrer">
                  {detail.ctaLabel || detail.landingUrl}
                </a>
              ) : (
                <span className="plan-cta-link plan-cta-link-disabled">
                  {detail.ctaLabel || (detail.landingUrl ? '（連結無效）' : '')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CreateAdPlanForm({ campaignID, onCreated }: { campaignID: string; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState<PlanDetail>(emptyPlanDetail)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isKKday = category === KKDAY_CATEGORY

  function updateDetail<K extends keyof PlanDetail>(key: K, value: PlanDetail[K]) {
    setDetail((d) => ({ ...d, [key]: value }))
  }

  function updateDeparture(index: number, field: keyof Departure, value: string) {
    setDetail((d) => ({
      ...d,
      departures: d.departures.map((dep, i) => (i === index ? { ...dep, [field]: value } : dep)),
    }))
  }

  function addDeparture() {
    setDetail((d) => ({ ...d, departures: [...d.departures, { date: '', weekday: '', price: '' }] }))
  }

  function removeDeparture(index: number) {
    setDetail((d) => ({ ...d, departures: d.departures.filter((_, i) => i !== index) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = isKKday ? { ...emptyPlanDetail(), desc: detail.desc, ctaLabel: detail.ctaLabel, landingUrl: detail.landingUrl, cid: detail.cid, fromPrice: detail.fromPrice } : { ...detail, cid: '' }
      await api.createAdPlan(campaignID, { title, category, detail: serializePlanDetail(payload) })
      setTitle('')
      setCategory('')
      setDetail(emptyPlanDetail())
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-panel">
      <div className="field">
        <label htmlFor="plan-title">方案標題</label>
        <input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="plan-category" id="plan-category-label">
            分類
          </label>
          <Select
            id="plan-category"
            labelId="plan-category-label"
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
          />
        </div>
        {!isKKday && (
          <div className="field" style={{ flex: '0 0 6rem' }}>
            <label htmlFor="plan-days">天數（選填）</label>
            <input id="plan-days" value={detail.days} onChange={(e) => updateDetail('days', e.target.value)} placeholder="例如：4" />
          </div>
        )}
      </div>

      {isKKday && (
        <div className="field-row">
          <div className="field" style={{ flex: '0 0 12rem' }}>
            <label htmlFor="plan-cid">KKday 聯盟代碼 cid</label>
            <input
              id="plan-cid"
              value={detail.cid}
              onChange={(e) => updateDetail('cid', e.target.value.trim())}
              placeholder="例如：tripace-27468"
              pattern="[A-Za-z0-9_\-]{1,64}"
              title="只能包含英數字、- 與 _"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="plan-kkday-url">KKday 商品網址</label>
            <input
              id="plan-kkday-url"
              type="url"
              value={detail.landingUrl}
              onChange={(e) => updateDetail('landingUrl', e.target.value)}
              placeholder="https://www.kkday.com/zh-tw/product/..."
              required
            />
          </div>
        </div>
      )}
      {isKKday && (
        <div className="field-row">
          <div className="field" style={{ flex: '0 0 12rem' }}>
            <label htmlFor="plan-from-price">參考價（選填）</label>
            <input
              id="plan-from-price"
              value={detail.fromPrice}
              onChange={(e) => updateDetail('fromPrice', e.target.value)}
              placeholder="例如：NT$ 599 起"
              maxLength={30}
            />
          </div>
          <div className="field">
            <label htmlFor="plan-kkday-cta">按鈕文案（選填）</label>
            <input
              id="plan-kkday-cta"
              value={detail.ctaLabel}
              onChange={(e) => updateDetail('ctaLabel', e.target.value)}
              placeholder="例如：預約九份夜遊（預設：查看場次與票價）"
            />
          </div>
        </div>
      )}

      {!isKKday && (
        <>
      {/* 出發日梯次——同一條行程可以有多個出發日,各自獨立報價(見
          PlanDetail.departures 的完整說明,對應使用者分享的真實旅行社
          出發日曆截圖)。 */}
      <div className="field">
        <label>出發日梯次（選填，可新增多個）</label>
        {detail.departures.map((dep, i) => (
          <div className="departure-row" key={i}>
            <DateInput
              ariaLabel={`梯次 ${i + 1} 出發日`}
              value={dep.date}
              onChange={(v) => updateDeparture(i, 'date', v)}
            />
            <input
              aria-label={`梯次 ${i + 1} 星期幾`}
              value={dep.weekday}
              onChange={(e) => updateDeparture(i, 'weekday', e.target.value)}
              placeholder="星期幾"
            />
            <input
              aria-label={`梯次 ${i + 1} 團費`}
              value={dep.price}
              onChange={(e) => updateDeparture(i, 'price', e.target.value)}
              placeholder="例如：$22,999"
            />
            <button type="button" className="secondary" onClick={() => removeDeparture(i)} aria-label={`刪除梯次 ${i + 1}`}>
              刪除
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={addDeparture} style={{ marginTop: detail.departures.length ? '0.5rem' : 0 }}>
          + 新增出發日梯次
        </button>
      </div>

      <div className="field">
        <label htmlFor="plan-original-price">原價（選填，整個方案共用的參考定價）</label>
        <input
          id="plan-original-price"
          value={detail.originalPrice}
          onChange={(e) => updateDetail('originalPrice', e.target.value)}
          placeholder="例如：$25,999"
        />
      </div>
      <div className="field">
        <label htmlFor="plan-desc">方案描述（選填）</label>
        <input
          id="plan-desc"
          value={detail.desc}
          onChange={(e) => updateDetail('desc', e.target.value)}
          placeholder="例如：小樽運河、白色戀人工廠，含三餐溫泉飯店"
        />
      </div>
      <div className="field">
        <label htmlFor="plan-highlights">行程亮點（選填，一行一項）</label>
        <textarea
          id="plan-highlights"
          rows={4}
          value={detail.highlights}
          onChange={(e) => updateDetail('highlights', e.target.value)}
          placeholder={'花海美景｜大阪璀璨花海\n嵐山觀光｜嵐山小火車\n古都名寺｜清水寺＋京都一晚'}
        />
      </div>
        </>
      )}
      {!isKKday && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="plan-cta">按鈕文案（選填）</label>
            <input id="plan-cta" value={detail.ctaLabel} onChange={(e) => updateDetail('ctaLabel', e.target.value)} placeholder="例如：立即報名" />
          </div>
          <div className="field">
            <label htmlFor="plan-url">連結網址（選填）</label>
            <input
              id="plan-url"
              type="url"
              value={detail.landingUrl}
              onChange={(e) => updateDetail('landingUrl', e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? '建立中…' : '建立方案'}
      </button>
    </form>
  )
}

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const placements = usePlacements()
  const [name, setName] = useState('')
  const [placement, setPlacement] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.createCampaign({ name, placement, startDate, endDate })
      setName('')
      setPlacement('')
      setStartDate('')
      setEndDate('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-panel">
      <div className="field">
        <label htmlFor="campaign-name">活動名稱</label>
        <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="campaign-placement" id="campaign-placement-label">
          投放頁面（選填，之後可以再編輯）
        </label>
        <Select
          id="campaign-placement"
          labelId="campaign-placement-label"
          value={placement}
          onChange={setPlacement}
          options={[UNSET_PLACEMENT_OPTION, ...placements]}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="campaign-start">開始日期</label>
          <DateInput id="campaign-start" value={startDate} onChange={setStartDate} />
        </div>
        <div className="field">
          <label htmlFor="campaign-end">結束日期</label>
          <DateInput id="campaign-end" value={endDate} onChange={setEndDate} />
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? '建立中…' : '建立活動'}
      </button>
    </form>
  )
}

// --- 儀表板(佔位頁)--------------------------------------------------------

// DashboardPanel 刻意先留空白——本次只搭架構(帳號系統、活動/方案
// CRUD),儀表板(曝光/點擊/轉換統計圖表)是下一階段的工作,需要先有
// 實際投放資料才有東西可畫。
function DashboardPanel() {
  return (
    <div className="card">
      <p className="empty-state">儀表板尚未開放，之後會顯示活動的曝光／點擊／轉換統計。</p>
    </div>
  )
}
