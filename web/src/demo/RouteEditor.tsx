import { useRef, useState } from 'react'
import { MapPin, Image as ImageIcon, Type, Route as RouteIcon, X, GripVertical } from 'lucide-react'
import styles from './RouteEditor.module.css'

// RouteEditor:旅程分享/路徑編輯器試做(見 docs/ 的雜誌式編輯介面構想與
// artifact mockup 討論)——這裡只做右側「雜誌內容編輯區」,左側常駐地圖
// (選點/即時連線)刻意先不做(見上方 DEMO_ROUTE_EDITOR_ENABLED 的說明,
// 使用者要求先聚焦右側,左側地圖之後再接);故「插入地點」目前只能新增
// 一張空白地點卡讓使用者手動填寫,不能像最終構想那樣點地圖選點/帶入
// 既有 attraction 資料,選單裡也停用「插入路線總覽圖」(需要地圖上的
// 站點座標才能畫)。純前端假資料,整份內容存在這個元件的 useState 裡,
// 不呼叫任何 API、重新整理後不會保留——資料庫 schema 與投稿/審核機制
// 都還在構想階段,尚未設計,見同一輪討論的 docs 文件。
//
// 型別/互動沿用 artifact mockup 驗證過的設計:contentEditable 風格的
// 行內編輯(點什麼就編什麼,沒有另外的「編輯模式」),區塊間隙 hover 浮現
// 插入按鈕,圖片區塊可切換全寬/靠左文繞/靠右文繞。

interface ParagraphBlock {
  id: string
  kind: 'paragraph'
  text: string
}

interface PlaceBlock {
  id: string
  kind: 'place'
  name: string
  desc: string
  source: 'library' | 'custom'
  photoGradient: string | null
}

type ImageAlign = 'full' | 'left' | 'right'

interface ImageBlock {
  id: string
  kind: 'image'
  caption: string
  align: ImageAlign
  gradient: string
}

type Block = ParagraphBlock | PlaceBlock | ImageBlock

let blockSeq = 0
function newBlockId() {
  blockSeq += 1
  return `blk_${blockSeq}`
}

const PLACE_GRADIENTS = [
  'linear-gradient(135deg, #C77B5A, #8B4A38)',
  'linear-gradient(135deg, #B99A72, #7A5C3E)',
  'linear-gradient(135deg, #A8B79E, #5C6B57)',
]

const INITIAL_BLOCKS: Block[] = [
  {
    id: newBlockId(),
    kind: 'paragraph',
    text: '清晨從八坂神社出發，沿著石板路拾級而上。這段路沒有太多遊客，只有掃街的店家與晨光穿過屋簷的聲音——是一天裡最適合放慢腳步的時刻。',
  },
  {
    id: newBlockId(),
    kind: 'place',
    name: '清水寺',
    desc: '778年僧延鎮於音羽の滝上結庵祀觀音，798年坂上田村麻呂建佛殿成為敕願寺。懸崖地形逼出「舞台造」懸空木構工法。',
    source: 'library',
    photoGradient: PLACE_GRADIENTS[0],
  },
  {
    id: newBlockId(),
    kind: 'paragraph',
    text: '走出清水寺後，沿著二年坂、三年坂緩緩往下。木造町家與傳統工藝小店林立，午前的光線斜斜打在石階上。',
  },
]

// 站點編號(place-index)只算 place 區塊,paragraph/image 不佔號碼——
// 這裡用陣列索引現算,不在 Block 上存一個固定的 index 欄位,理由是插入/
// 刪除/拖拉排序後號碼要自動遞補,存固定值反而要在每次操作後手動同步,
// 現算才不會有兩份資料互相漏同步的風險。
function placeNumber(blocks: Block[], blockId: string): number {
  let n = 0
  for (const b of blocks) {
    if (b.kind === 'place') {
      n += 1
      if (b.id === blockId) return n
    }
  }
  return 0
}

function EditableDiv({
  className,
  value,
  placeholder,
  onChange,
  previewing = false,
}: {
  className: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  previewing?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className={className}
      contentEditable={!previewing}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => onChange(e.currentTarget.textContent ?? '')}
    >
      {value || placeholder}
    </div>
  )
}

function InsertMenu({
  open,
  onToggle,
  onInsertParagraph,
  onInsertPlace,
  onInsertImage,
}: {
  open: boolean
  onToggle: () => void
  onInsertParagraph: () => void
  onInsertPlace: () => void
  onInsertImage: () => void
}) {
  return (
    <div className={styles.gap}>
      <div className={styles.gapLine} />
      <div className={`${styles.insertBtn}${open ? ` ${styles.menuOpen}` : ''}`} onClick={onToggle}>
        +
      </div>
      {open && (
        <div className={styles.insertMenu}>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertPlace}>
            <span className={styles.insertMenuIcon}><MapPin size={15} strokeWidth={2} /></span>
            插入地點
          </button>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertImage}>
            <span className={styles.insertMenuIcon}><ImageIcon size={15} strokeWidth={2} /></span>
            插入圖片
          </button>
          <button type="button" className={styles.insertMenuItem} disabled title="左側地圖尚未實作，暫時無法產生路線總覽圖">
            <span className={styles.insertMenuIcon}><RouteIcon size={15} strokeWidth={2} /></span>
            插入路線總覽圖
          </button>
          <button type="button" className={styles.insertMenuItem} onClick={onInsertParagraph}>
            <span className={styles.insertMenuIcon}><Type size={15} strokeWidth={2} /></span>
            插入段落
          </button>
        </div>
      )}
    </div>
  )
}

export function RouteEditor() {
  const [title, setTitle] = useState('東山慢走一日')
  const [lede, setLede] = useState('從信仰中心到藝伎小巷，一條串起清水舞台、坡道老街與寧靜寺院的東山步行動線。')
  const [blocks, setBlocks] = useState<Block[]>(INITIAL_BLOCKS)
  const [openMenuAt, setOpenMenuAt] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const placeCount = blocks.filter((b) => b.kind === 'place').length

  function insertAt(index: number, block: Block) {
    setBlocks((prev) => {
      const next = prev.slice()
      next.splice(index, 0, block)
      return next
    })
    setOpenMenuAt(null)
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } as Block : b)))
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); return }
    setBlocks((prev) => {
      const next = prev.slice()
      const [moved] = next.splice(dragIndex, 1)
      const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
      next.splice(insertIndex, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.mapPendingNotice}>
        <MapPin size={13} strokeWidth={2} />
        左側地圖尚未實作 — 目前僅支援手動輸入地點，無法從地圖選點或帶入既有地標
      </div>

      <div className={styles.topbar}>
        <div className={styles.topbarMeta}>
          <span className={styles.topbarEyebrow}>路徑編輯器 · 試做 · 草稿</span>
          <span className={styles.topbarStatus}><span className="dot" />尚未儲存（前端假資料，重新整理將遺失）</span>
        </div>
        <div className={styles.topbarRight}>
          <button type="button" className={styles.btn} onClick={() => setPreviewing((v) => !v)}>
            {previewing ? '返回編輯' : '預覽'}
          </button>
          <button type="button" className={styles.btnPrimary} disabled title="投稿審核機制尚未設計">
            投稿審核
          </button>
        </div>
      </div>

      <div className={styles.articlePane}>
        <div className={styles.cover}>
          <div className={styles.coverEditHint}>點擊更換封面（試做未實作上傳）</div>
          <div className={styles.coverCaption}>
            <div className={styles.coverEyebrow}>{placeCount} 個地點 · 路徑草稿</div>
            <EditableDiv className={styles.coverTitle} value={title} placeholder="輸入路徑標題" onChange={setTitle} />
          </div>
        </div>

        <div className={styles.articleInner}>
          <EditableDiv className={styles.lede} value={lede} placeholder="寫一段整體介紹……" onChange={setLede} />

          <InsertMenu
            open={openMenuAt === 0}
            onToggle={() => setOpenMenuAt((v) => (v === 0 ? null : 0))}
            onInsertParagraph={() => insertAt(0, { id: newBlockId(), kind: 'paragraph', text: '' })}
            onInsertPlace={() => insertAt(0, {
              id: newBlockId(), kind: 'place', name: '', desc: '', source: 'custom', photoGradient: null,
            })}
            onInsertImage={() => insertAt(0, {
              id: newBlockId(), kind: 'image', caption: '', align: 'full',
              gradient: PLACE_GRADIENTS[Math.floor(Math.random() * PLACE_GRADIENTS.length)],
            })}
          />

          {blocks.map((block, i) => (
            <div
              key={block.id}
              // 這層 wrapper 只負責拖拉排序的事件掛點,故意不设 display:
              // block 以外的任何版面屬性(不能是 flex/grid 容器,那樣會
              // 建立新的格式化上下文、讓內部的浮動圖片區塊無法把接下來
              // 的段落文字拉進來環繞)——文繞圖能不能生效,取決於浮動
              // 元素與被環繞的段落是否共處同一個區塊格式化上下文,兩者
              // 分別包在不相通的容器裡就會失效,這是先前版本(用 <textarea>
              // 且每個區塊各自獨立包一層 <div draggable>)文繞圖不生效的
              // 根本原因;拿掉多餘包裝、段落改用 EditableDiv 後才恢復
              // 正常的 CSS float 環繞語意。
              draggable={!previewing}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
            >
              {block.kind === 'paragraph' && (
                <EditableDiv
                  className={styles.paragraph}
                  value={block.text}
                  placeholder="寫下這段的故事……"
                  onChange={(v) => updateBlock(block.id, { text: v })}
                />
              )}

              {block.kind === 'place' && (
                <div className={styles.placeCard}>
                  {!previewing && (
                    <button type="button" className={styles.placeRemove} onClick={() => removeBlock(block.id)} title="刪除此站">
                      <X size={13} strokeWidth={2} />
                    </button>
                  )}
                  <div
                    className={`${styles.placePhoto}${!block.photoGradient ? ` ${styles.placePhotoEmpty}` : ''}`}
                    style={block.photoGradient ? { backgroundImage: block.photoGradient } : undefined}
                  >
                    <div className={styles.placePhotoOverlay}>
                      <ImageIcon size={16} strokeWidth={2} />
                      {block.photoGradient ? '更換照片' : '上傳照片'}（試做未實作上傳）
                    </div>
                  </div>
                  <div className={styles.placeBody}>
                    <div className={styles.placeHead}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.placeIndex}>
                          <span className={styles.num}>{placeNumber(blocks, block.id)}</span>
                          站點{placeNumber(blocks, block.id)}
                        </div>
                        <EditableDiv
                          className={styles.placeName}
                          value={block.name}
                          placeholder="輸入地點名稱"
                          onChange={(v) => updateBlock(block.id, { name: v })}
                        />
                      </div>
                      <span className={`${styles.placeSource}${block.source === 'custom' ? ` ${styles.placeSourceCustom}` : ''}`}>
                        {block.source === 'custom' ? '自訂地點' : '來自地標庫'}
                      </span>
                    </div>
                    <EditableDiv
                      className={styles.placeDesc}
                      value={block.desc}
                      placeholder="寫下這裡的故事……"
                      onChange={(v) => updateBlock(block.id, { desc: v })}
                    />
                  </div>
                </div>
              )}

              {block.kind === 'image' && (
                <div
                  className={`${styles.imageBlock}${block.align === 'left' ? ` ${styles.imageBlockFloatLeft}` : block.align === 'right' ? ` ${styles.imageBlockFloatRight}` : ''}`}
                >
                  {!previewing && (
                    <>
                      <div className={styles.imageToolbar}>
                        <button
                          type="button"
                          className={`${styles.imageToolbarBtn}${block.align === 'left' ? ` ${styles.imageToolbarBtnActive}` : ''}`}
                          title="靠左文繞"
                          onClick={() => updateBlock(block.id, { align: 'left' })}
                        >
                          <GripVertical size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.imageToolbarBtn}${block.align === 'full' ? ` ${styles.imageToolbarBtnActive}` : ''}`}
                          title="全寬"
                          onClick={() => updateBlock(block.id, { align: 'full' })}
                        >
                          <ImageIcon size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.imageToolbarBtn}${block.align === 'right' ? ` ${styles.imageToolbarBtnActive}` : ''}`}
                          title="靠右文繞"
                          onClick={() => updateBlock(block.id, { align: 'right' })}
                        >
                          <GripVertical size={13} strokeWidth={2} />
                        </button>
                      </div>
                      <button type="button" className={styles.imageRemove} onClick={() => removeBlock(block.id)} title="刪除圖片">
                        <X size={12} strokeWidth={2} />
                      </button>
                    </>
                  )}
                  <div className={styles.imageFill} style={{ background: block.gradient }} />
                  <EditableDiv
                    className={styles.imageCaption}
                    value={block.caption}
                    placeholder="這張圖的說明文字……"
                    onChange={(v) => updateBlock(block.id, { caption: v })}
                  />
                </div>
              )}

              {!previewing && (
                <InsertMenu
                  open={openMenuAt === i + 1}
                  onToggle={() => setOpenMenuAt((v) => (v === i + 1 ? null : i + 1))}
                  onInsertParagraph={() => insertAt(i + 1, { id: newBlockId(), kind: 'paragraph', text: '' })}
                  onInsertPlace={() => insertAt(i + 1, {
                    id: newBlockId(), kind: 'place', name: '', desc: '', source: 'custom', photoGradient: null,
                  })}
                  onInsertImage={() => insertAt(i + 1, {
                    id: newBlockId(), kind: 'image', caption: '', align: 'full',
                    gradient: PLACE_GRADIENTS[Math.floor(Math.random() * PLACE_GRADIENTS.length)],
                  })}
                />
              )}
            </div>
          ))}

          <footer className={styles.endNote}>
            <MapPin size={13} strokeWidth={2} />
            {placeCount} 個地點
          </footer>
        </div>
      </div>
    </div>
  )
}
