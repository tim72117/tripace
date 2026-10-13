import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CITY_OPTIONS,
  DEMO_ADVERTISERS,
  DEMO_CAMPAIGNS,
  DEMO_DAILY_STATS,
  PLACEMENT_OPTIONS,
  STATUS_LABEL,
  TIER_LABEL,
  type CampaignStatus,
  type DemoAdvertiser,
  type DemoCampaign,
} from './adAdminDemoData'
import styles from './AdAdminDemoPage.module.css'

// AdAdminDemoPage:投放設定介面範例,對應
// docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md 的規劃內容。
//
// 這不是真的 web/admin 分頁——web/admin 是獨立建置的 SPA(有自己的
// api.ts/認證流程),這裡是在主站 /showcase-demo 底下做一個「看起來像
// Admin SPA」的純前端假資料範例,用同一套 web/admin/src/style.css 的
// 視覺語言(card/tabs/table-scroll/badge/status-dot 等既有 class),
// 讓這份規劃「長什麼樣子」可以被直接看到、點過一輪,而不是只停留在
// 文字規劃。所有資料都是 adAdminDemoData.ts 的假資料,新增/編輯操作
// 只改這個元件內的 React state,重新整理頁面就會回到初始假資料,沒有
// 任何後端串接。
//
// 三個子分頁(Advertisers/Campaigns/Stats)直接對應規劃文件第 1 節的
// 分頁結構決策,各自拆成獨立元件(AdvertisersTab/CampaignsTab/StatsTab)
// 在檔案下方定義,呼應既有 web/admin/src/App.tsx 把每個分頁寫成同檔案
// 內獨立函式的既有寫法。
type DemoTab = 'advertisers' | 'campaigns' | 'stats'

export function AdAdminDemoPage() {
  const [tab, setTab] = useState<DemoTab>('campaigns')
  const [advertisers] = useState<DemoAdvertiser[]>(DEMO_ADVERTISERS)
  const [campaigns, setCampaigns] = useState<DemoCampaign[]>(DEMO_CAMPAIGNS)

  return (
    <div className={`${styles.wrap} ${styles['admin-demo-theme']}`}>
      <div className={styles.inner}>
        <Link to="/ad-system" className={styles.back}>
          ← 回廣告投放系統雛形
        </Link>

        <p className={styles.noteBanner}>
          範例介面——純前端假資料,模擬 web/admin 的視覺風格與互動流程,沒有真實後端串接。
          對應規劃：docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md
        </p>

        <header className="topbar">
          <div>
            <h1>Tripace admin（範例）</h1>
            <span className="muted">demo-operator@tripace.example</span>
          </div>
        </header>

        <nav className="tabs">
          <button className={tab === 'advertisers' ? 'tab active' : 'tab'} onClick={() => setTab('advertisers')}>
            Advertisers
          </button>
          <button className={tab === 'campaigns' ? 'tab active' : 'tab'} onClick={() => setTab('campaigns')}>
            Campaigns
          </button>
          <button className={tab === 'stats' ? 'tab active' : 'tab'} onClick={() => setTab('stats')}>
            Stats
          </button>
        </nav>

        {tab === 'advertisers' && <AdvertisersTab advertisers={advertisers} />}
        {tab === 'campaigns' && (
          <CampaignsTab advertisers={advertisers} campaigns={campaigns} setCampaigns={setCampaigns} />
        )}
        {tab === 'stats' && <StatsTab campaigns={campaigns} />}
      </div>
    </div>
  )
}

// ===== Advertisers =====
// 對應規劃文件第 2 節:單一表格,不做刪除只能停用,這裡的「編輯」/「+
// 新增廣告主」按鈕是視覺雛形(alert 提示),理由同其他雛形頁的既有慣例
// ——雛形階段先驗證版面,真的要做表單互動需要先確認欄位驗證規則等細節。
function AdvertisersTab({ advertisers }: { advertisers: DemoAdvertiser[] }) {
  return (
    <section className="card">
      <div className="section-head">
        <h2>廣告主</h2>
        <button onClick={() => alert('雛形：開啟新增廣告主表單（未串接）')}>+ 新增廣告主</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>名稱</th>
              <th>聯絡窗口</th>
              <th>狀態</th>
              <th>建立時間</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {advertisers.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  {a.contactName} · <span className="muted">{a.contactEmail}</span>
                </td>
                <td>
                  <span className={`${styles.statusDot} ${a.status === 'active' ? styles.statusDotActive : styles.statusDotSuspended}`} />
                  {a.status === 'active' ? '啟用中' : '已停用'}
                </td>
                <td className="muted">{a.createdAt}</td>
                <td className="row-actions">
                  <button className="ghost" onClick={() => alert('雛形：編輯廣告主（未串接）')}>
                    編輯
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ===== Campaigns =====
// 對應規劃文件第 3 節:列表 + 編輯單一活動兩個畫面。editingId 為 null
// 時顯示列表,非 null 時顯示該活動的編輯表單(含素材管理),'new' 代表
// 正在建立新活動(用一個空白的草稿物件,不寫進 campaigns 陣列直到使用者
// 按下「建立」)。
function CampaignsTab({
  advertisers,
  campaigns,
  setCampaigns,
}: {
  advertisers: DemoAdvertiser[]
  campaigns: DemoCampaign[]
  setCampaigns: (updater: (prev: DemoCampaign[]) => DemoCampaign[]) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all')

  const advertiserName = (id: string) => advertisers.find((a) => a.id === id)?.name ?? id

  const filtered = statusFilter === 'all' ? campaigns : campaigns.filter((c) => c.status === statusFilter)

  const editing = campaigns.find((c) => c.id === editingId) ?? null

  if (editing) {
    return (
      <CampaignEditor
        campaign={editing}
        advertisers={advertisers}
        onBack={() => setEditingId(null)}
        onSave={(updated) => {
          setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
          setEditingId(null)
        }}
      />
    )
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>廣告活動</h2>
        <button onClick={() => alert('雛形：建立新活動（未串接，需要先選定廣告主才能進入編輯畫面）')}>
          + 新增活動
        </button>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.filterLabel}>
          狀態篩選
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CampaignStatus | 'all')}>
            <option value="all">全部</option>
            {(Object.keys(STATUS_LABEL) as CampaignStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>廣告主</th>
              <th>活動名稱</th>
              <th>狀態</th>
              <th>檔期</th>
              <th>投放版位</th>
              <th>Tier</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>{advertiserName(c.advertiserId)}</td>
                <td>{c.name}</td>
                <td>
                  <span className={`${styles.statusBadge} ${styles[`status_${c.status}`]}`}>{STATUS_LABEL[c.status]}</span>
                </td>
                <td className="muted">
                  {c.startDate} ～ {c.endDate}
                </td>
                <td>
                  {c.placements.length === 0 ? (
                    <span className="muted">（尚未勾選）</span>
                  ) : (
                    c.placements.map((p) => (
                      <span key={p} className="badge">
                        {PLACEMENT_OPTIONS.find((o) => o.key === p)?.label ?? p}
                      </span>
                    ))
                  )}
                </td>
                <td>{TIER_LABEL[c.tier]}</td>
                <td className="row-actions">
                  <button className="ghost" onClick={() => setEditingId(c.id)}>
                    編輯
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// CampaignEditor——單一活動的編輯畫面,對應規劃文件第 3.2 節列出的
// 每個區塊(基本資料/投放版位/投放條件/優先權重/每日曝光上限/素材
// 管理)。用本地 draft state 暫存編輯中的內容,按「儲存」才回寫給
// 呼叫端(對齊真實表單「編輯中/已提交」兩階段的常見設計,避免每個
// input 改一個字就直接污染外層列表資料)。
function CampaignEditor({
  campaign,
  advertisers,
  onBack,
  onSave,
}: {
  campaign: DemoCampaign
  advertisers: DemoAdvertiser[]
  onBack: () => void
  onSave: (updated: DemoCampaign) => void
}) {
  const [draft, setDraft] = useState<DemoCampaign>(campaign)

  const togglePlacement = (key: string) => {
    setDraft((prev) => ({
      ...prev,
      placements: prev.placements.includes(key)
        ? prev.placements.filter((p) => p !== key)
        : [...prev.placements, key],
    }))
  }

  const toggleCity = (city: string) => {
    setDraft((prev) => ({
      ...prev,
      targetCities: prev.targetCities.includes(city)
        ? prev.targetCities.filter((c) => c !== city)
        : [...prev.targetCities, city],
    }))
  }

  return (
    <>
      <div className="section-head">
        <h2>{campaign.name}</h2>
        <div className="row-actions">
          <button className="ghost" onClick={onBack}>
            取消
          </button>
          <button onClick={() => onSave(draft)}>儲存</button>
        </div>
      </div>

      <section className="card">
        <h2>基本資料</h2>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            廣告主
            <select
              value={draft.advertiserId}
              onChange={(e) => setDraft((p) => ({ ...p, advertiserId: e.target.value }))}
            >
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.formField}>
            活動名稱
            <input type="text" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label className={styles.formField}>
            狀態
            <select
              value={draft.status}
              onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value as CampaignStatus }))}
            >
              {(Object.keys(STATUS_LABEL) as CampaignStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.formField}>
            開始日期
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))}
            />
          </label>
          <label className={styles.formField}>
            結束日期
            <input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>投放版位</h2>
        <p className="muted">勾選這個活動要投放在哪些版位。</p>
        <div className={styles.checkList}>
          {PLACEMENT_OPTIONS.map((opt) => (
            <label key={opt.key} className={styles.checkItem}>
              <input
                type="checkbox"
                checked={draft.placements.includes(opt.key)}
                onChange={() => togglePlacement(opt.key)}
              />
              <span>
                <strong>{opt.label}</strong>
                <span className={styles.checkItemDesc}>{opt.positionDesc}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>投放條件</h2>
        <p className="muted">留空代表不限制（例如城市不勾選，代表所有城市都可能投放這個活動）。</p>
        <div className={styles.checkList}>
          {CITY_OPTIONS.map((city) => (
            <label key={city} className={styles.checkItemInline}>
              <input type="checkbox" checked={draft.targetCities.includes(city)} onChange={() => toggleCity(city)} />
              {city}
            </label>
          ))}
        </div>
        <label className={styles.formField} style={{ marginTop: '0.75rem', maxWidth: '240px' }}>
          裝置
          <select
            value={draft.targetDevice}
            onChange={(e) => setDraft((p) => ({ ...p, targetDevice: e.target.value as DemoCampaign['targetDevice'] }))}
          >
            <option value="any">不限</option>
            <option value="mobile">僅手機</option>
            <option value="desktop">僅桌面</option>
          </select>
        </label>
      </section>

      <section className="card">
        <h2>優先權重</h2>
        <p className="muted">同一版位有多個符合條件的活動時，先選 tier 最高的一層，同層內依 weight 隨機抽選。</p>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            Tier
            <select value={draft.tier} onChange={(e) => setDraft((p) => ({ ...p, tier: e.target.value as DemoCampaign['tier'] }))}>
              {(Object.keys(TIER_LABEL) as DemoCampaign['tier'][]).map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.formField}>
            Weight
            <input
              type="number"
              min={1}
              value={draft.weight}
              onChange={(e) => setDraft((p) => ({ ...p, weight: Number(e.target.value) }))}
              style={{ width: '6rem' }}
            />
          </label>
          <label className={styles.formField}>
            每日曝光上限（留空＝不限制）
            <input
              type="number"
              min={0}
              value={draft.dailyCapImpressions ?? ''}
              placeholder="不限制"
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  dailyCapImpressions: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              style={{ width: '8rem' }}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>素材</h2>
          <button onClick={() => alert('雛形：開啟素材上傳表單（未串接，實際會沿用既有 photoupload 簽名 URL 流程）')}>
            + 新增素材
          </button>
        </div>
        {draft.creatives.length === 0 ? (
          <p className="muted">這個活動還沒有素材——狀態是「草稿」時通常是因為素材尚未備齊。</p>
        ) : (
          <div className={styles.creativeList}>
            {draft.creatives.map((cr) => (
              <div key={cr.id} className={styles.creativePreviewRow}>
                {/* 預覽卡片——視覺語言對齊 /showcase-demo/ad-system 的
                    .sponsoredCard,呼應規劃文件「素材上傳後直接渲染跟
                    前台相同的卡片樣式預覽」的設計意圖,讓營運人員上稿
                    當下就能看到前台實際呈現效果。 */}
                <div className={styles.creativePreviewCard}>
                  <div className={styles.creativePreviewCover}>{cr.coverEmoji}</div>
                  <div className={styles.creativePreviewBody}>
                    <span className={styles.creativePreviewLabel}>贊助・{advertisers.find((a) => a.id === draft.advertiserId)?.name}</span>
                    <strong>{cr.title}</strong>
                    <p>{cr.desc}</p>
                    <span className={styles.creativePreviewCta}>{cr.ctaLabel}</span>
                  </div>
                </div>
                <div className={styles.creativeMeta}>
                  <div className="muted">{cr.landingUrl}</div>
                  <div className="row-actions">
                    <span className="badge">{cr.status === 'active' ? '啟用中' : '已暫停'}</span>
                    <button className="ghost" onClick={() => alert('雛形：編輯素材（未串接）')}>
                      編輯
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

// ===== Stats =====
// 對應規劃文件第 4 節:唯讀報表。這裡不直接依賴 web/admin 的
// TimelineChart(那個元件在獨立建置的 web/admin 套件裡,主站沒有引用
// 既有慣例),改用簡化版的純 SVG 折線圖示意同樣的資料呈現方式——真正
// 實作時應該沿用 TimelineChart 本身,這裡只是範例介面,ない需要重新
// 做一份一模一樣的圖表元件。
function StatsTab({ campaigns }: { campaigns: DemoCampaign[] }) {
  const [campaignFilter, setCampaignFilter] = useState<string>('all')

  const rows = useMemo(
    () => (campaignFilter === 'all' ? DEMO_DAILY_STATS : DEMO_DAILY_STATS.filter((r) => r.campaignId === campaignFilter)),
    [campaignFilter],
  )

  const totals = useMemo(() => {
    const byCampaign = new Map<string, { impressions: number; clicks: number }>()
    for (const r of DEMO_DAILY_STATS) {
      const cur = byCampaign.get(r.campaignId) ?? { impressions: 0, clicks: 0 }
      cur.impressions += r.impressions
      cur.clicks += r.clicks
      byCampaign.set(r.campaignId, cur)
    }
    return byCampaign
  }, [])

  const maxImpressions = Math.max(...rows.map((r) => r.impressions), 1)
  const dates = Array.from(new Set(rows.map((r) => r.date)))

  return (
    <section className="card">
      <div className="section-head">
        <h2>投放報表</h2>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.filterLabel}>
          活動
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
            <option value="all">全部</option>
            {campaigns
              .filter((c) => totals.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {/* 簡化版折線圖——示意「每日曝光數」走勢,真實實作建議沿用
          web/admin/src/TimelineChart.tsx,不是這裡重新做一份。 */}
      <svg viewBox={`0 0 ${dates.length * 40} 120`} className={styles.chart} preserveAspectRatio="none">
        {dates.map((d, i) => {
          const dayRows = rows.filter((r) => r.date === d)
          const total = dayRows.reduce((sum, r) => sum + r.impressions, 0)
          const h = (total / maxImpressions) * 90
          return (
            <g key={d}>
              <rect x={i * 40 + 8} y={110 - h} width={24} height={h} className={styles.chartBar} />
              <text x={i * 40 + 20} y={118} textAnchor="middle" className={styles.chartLabel}>
                {d}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>活動</th>
              <th>總曝光</th>
              <th>總點擊</th>
              <th>CTR</th>
            </tr>
          </thead>
          <tbody>
            {campaigns
              .filter((c) => totals.has(c.id))
              .map((c) => {
                const t = totals.get(c.id)!
                const ctr = t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(1) : '0.0'
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{t.impressions}</td>
                    <td>{t.clicks}</td>
                    <td>{ctr}%</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
