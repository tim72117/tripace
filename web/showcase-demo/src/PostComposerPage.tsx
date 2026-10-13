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
      </div>
    </div>
  )
}
