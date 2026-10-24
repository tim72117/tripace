import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DRAFT_STYLE_LABEL, MOCK_DRAFTS, MOCK_MATCHES, MOCK_PHOTOS, type DraftStyle } from './postComposerData'
import styles from './PostComposerPage.module.css'

type FlowStep = 'upload' | 'processing' | 'match' | 'draft'

// PostComposerPage:構想五(發文工具產品線)雛形——使用者表示「先從這裡
// 開始做」,文件核心流程是「圖片處理 → AI 產文 → 開放外部 AI 串接 →
// 部落客分潤」,這裡先做前兩段(圖片處理 + AI 產文)的互動雛形,對應
// 文件延伸方案「先把圖片處理的範圍縮到最小可行」「產文先綁定既有行程
// 資料試水溫」——假設使用者已經在 tripace 排過九份一日遊這趟行程
// (呼應 ItineraryShowcasePage 的同一個行程範例,資料不互相引用,避免
// 跨雛形頁面耦合)。
//
// 外部 AI 串接、分潤機制兩段,文件自己也建議「分潤機制務必最後做」
// (牽涉金流/信任機制,複雜度高,應該排在前面都驗證過之後),這裡只用
// 文字說明交代構想,不做假 UI——做一個看起來能點但完全沒意義的假分潤
// 畫面,對理解這個構想沒有幫助,反而可能讓人誤以為這塊已經設計過。
export function PostComposerPage() {
  const [step, setStep] = useState<FlowStep>('upload')
  const [style, setStyle] = useState<DraftStyle>('concise')

  const draft = MOCK_DRAFTS[style]

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>發文工具：圖片處理＋AI 產文</h1>
        <p className={styles.subheading}>
          使用者上傳照片 → AI 去重整理 → 比對這趟旅程的行程資料 → 產生遊記初稿。
          假設這趟旅程是九份一日遊（沿用先前已排過的行程資料）。
        </p>

        <div className={styles.steps}>
          <div className={`${styles.step}${step === 'upload' ? ` ${styles.stepActive}` : ` ${styles.stepDone}`}`}>
            1. 上傳照片
          </div>
          <div
            className={`${styles.step}${step === 'processing' ? ` ${styles.stepActive}` : step === 'match' || step === 'draft' ? ` ${styles.stepDone}` : ''}`}
          >
            2. 圖片處理
          </div>
          <div
            className={`${styles.step}${step === 'match' ? ` ${styles.stepActive}` : step === 'draft' ? ` ${styles.stepDone}` : ''}`}
          >
            3. 比對行程
          </div>
          <div className={`${styles.step}${step === 'draft' ? ` ${styles.stepActive}` : ''}`}>4. AI 產文</div>
        </div>

        <div className={styles.panel}>
          {step === 'upload' && (
            <>
              <p>點擊下方按鈕模擬上傳這趟旅程拍的照片（雛形不支援真實檔案上傳）。</p>
              <div className={styles.photoGrid}>
                {MOCK_PHOTOS.map((p) => (
                  <div key={p.id} className={styles.photoThumb}>
                    {p.emoji}
                  </div>
                ))}
              </div>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnPrimary} onClick={() => setStep('processing')}>
                  上傳這 {MOCK_PHOTOS.length} 張照片
                </button>
              </div>
            </>
          )}

          {step === 'processing' && (
            <>
              <p>AI 正在整理照片：排序建議、去重模糊/重複照片、挑出代表性照片。</p>
              <div className={styles.photoGrid}>
                {MOCK_PHOTOS.map((p) => (
                  <div
                    key={p.id}
                    className={`${styles.photoThumb}${p.isDuplicate ? ` ${styles.photoThumbDup}` : ''}`}
                  >
                    {p.emoji}
                    {p.isDuplicate && <span className={styles.photoThumbBadge}>重複</span>}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ios-gray)' }}>
                偵測到 {MOCK_PHOTOS.filter((p) => p.isDuplicate).length} 張重複/模糊照片，已自動淡化排除。
              </p>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnSecondary} onClick={() => setStep('upload')}>
                  上一步
                </button>
                <button type="button" className={styles.btnPrimary} onClick={() => setStep('match')}>
                  比對行程資料
                </button>
              </div>
            </>
          )}

          {step === 'match' && (
            <>
              <p>
                因為這趟旅程已經在 tripace 排過行程，AI 不需要從零猜測「這張照片是哪裡」，
                直接對照時間軸的景點名稱與時間：
              </p>
              <ul className={styles.matchList}>
                {MOCK_MATCHES.map((m) => {
                  const photo = MOCK_PHOTOS.find((p) => p.id === m.photoId)
                  return (
                    <li key={m.photoId} className={styles.matchItem}>
                      <div className={styles.matchThumb}>{photo?.emoji}</div>
                      <span className={styles.matchArrow}>→</span>
                      <span className={styles.matchPlace}>{m.place}</span>
                      <span style={{ color: 'var(--ios-gray)' }}>（{m.time}）</span>
                    </li>
                  )
                })}
              </ul>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnSecondary} onClick={() => setStep('processing')}>
                  上一步
                </button>
                <button type="button" className={styles.btnPrimary} onClick={() => setStep('draft')}>
                  產生遊記初稿
                </button>
              </div>
            </>
          )}

          {step === 'draft' && (
            <>
              <div className={styles.styleTabs}>
                {(Object.keys(DRAFT_STYLE_LABEL) as DraftStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.styleTab}${style === s ? ` ${styles.styleTabActive}` : ''}`}
                    onClick={() => setStyle(s)}
                  >
                    {DRAFT_STYLE_LABEL[s]}
                  </button>
                ))}
              </div>
              <h2 className={styles.draftTitle}>{draft.title}</h2>
              <p className={styles.draftBody}>{draft.body}</p>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnSecondary} onClick={() => setStep('match')}>
                  上一步
                </button>
                <button type="button" className={styles.btnPrimary} onClick={() => alert('雛形：發布文章（未串接）')}>
                  發布文章
                </button>
              </div>
            </>
          )}
        </div>

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          「開放外部 AI 串接」（結構化資料匯出/webhook）與「部落客分潤機制」兩段未實作——
          文件本身也建議分潤機制應排在圖片處理/AI 產文/外部串接都驗證過使用者真的願意用之後才投入設計，
          這裡只保留文字構想，不做沒有意義的假 UI。
        </div>

        {/* 補充說明區塊:AI 產文(step 4)目前只是顯示一段純文字初稿,但 tripace
            既有的部落格文章系統(content_pages 表)其實有一套固定的版面格式——
            文章內容是一個扁平的 blocks 陣列,由 paragraph/image/gallery/stop/
            捲動時間軸幾種區塊組成。這套規則定義在 .claude/skills/blog-article-content
            這份 skill 文件裡(給 Claude 操作用),這裡用給人看的方式重新整理一次,
            讓「AI 產文」這個構想的輸出格式從一開始就對齊既有系統,不是另外自創一套。
            這是補充說明,不是取代上面四步驟的互動流程。 */}
        <div className={styles.layoutRules}>
          <h2 className={styles.layoutRulesTitle}>補充說明：AI 產文最終要符合既有版面格式</h2>
          <p className={styles.layoutRulesIntro}>
            上面「4. AI 產文」目前只示範產出一段純文字初稿。但實際要發布的文章，內容會存成既有部落格系統
            （<code className={styles.inlineCode}>content_pages</code> 資料表）的 <code className={styles.inlineCode}>blocks</code>{' '}
            扁平陣列——由幾種固定「區塊種類」組成，而不是整段純文字。AI 產文這個構想要串接發布，
            最終輸出就要對齊這套格式。
          </p>

          <h3 className={styles.layoutRulesSubtitle}>區塊種類一覽</h3>
          <div className={styles.blockKindGrid}>
            <div className={styles.blockKindCard}>
              <span className={styles.blockKindTag}>paragraph</span>
              <p>一般文字段落，也可標成小標題/強調句/引言/小字說明。</p>
            </div>
            <div className={styles.blockKindCard}>
              <span className={styles.blockKindTag}>image</span>
              <p>單張照片，可選擇欄寬/外擴/滿版，或疊字在圖片上呈現短句。</p>
            </div>
            <div className={styles.blockKindCard}>
              <span className={styles.blockKindTag}>gallery</span>
              <p>同一場景的多張照片（2～4 張）一起排版，有格狀/密集多欄/雜誌拼貼等版式。</p>
            </div>
            <div className={styles.blockKindCard}>
              <span className={styles.blockKindTag}>stop</span>
              <p>逐站介紹用的站點卡片，帶編號、站名、介紹文字與這一站的照片。</p>
            </div>
            <div className={styles.blockKindCard}>
              <span className={styles.blockKindTag}>scroll-timeline</span>
              <p>把一段內容包進互動式小地圖時間軸，用 start/anchor/end 三種標記夾住。</p>
            </div>
          </div>

          <h3 className={styles.layoutRulesSubtitle}>AI 產文時怎麼決定排版</h3>
          <p className={styles.layoutRulesIntro}>
            每個場景先看「有幾張內容上合適的照片」，再決定要用哪種區塊——這個判斷邏輯 AI 產文也要照著做：
          </p>
          <ul className={styles.decisionList}>
            <li>
              <strong>0 張照片</strong>：這段落不放圖片區塊，純文字呈現，不要硬塞不相關的照片湊版面。
            </li>
            <li>
              <strong>1 張照片</strong>：用 <code className={styles.inlineCode}>image</code>
              ——文字夠長就讓圖片靠一側文繞排，文字短就把文字疊在圖片上，單純想要一張有存在感的代表照就用外擴/滿版。
            </li>
            <li>
              <strong>2 張以上</strong>：改用 <code className={styles.inlineCode}>gallery</code>，不要拆成好幾個獨立的{' '}
              <code className={styles.inlineCode}>image</code>——2～4 張用格狀排列、5 張以上改密集多欄排列，最多只放 4 張，多出來的留著當候補。
            </li>
          </ul>

          <h3 className={styles.layoutRulesSubtitle}>圖片引用：photoId，不是外部網址</h3>
          <p className={styles.layoutRulesIntro}>
            文章裡的每張圖片都是用 <code className={styles.inlineCode}>photoId</code> 引用既有的已上傳照片，
            絕對不會直接寫檔名或外部網址——這代表「AI 產文」這個構想要串接發布，前提是照片必須先經過本頁
            「1. 上傳照片 → 2. 圖片處理」流程產生對應的 <code className={styles.inlineCode}>photoId</code>，
            AI 產出的內容只能引用這些 ID，不能憑空生成或連結外部圖片網址。
          </p>
        </div>
      </div>
    </div>
  )
}
