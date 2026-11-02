// draftStore——部落格的「純前端草稿」:存在瀏覽器 IndexedDB,不經過後端。
//
// 兩種草稿:
// 1. 文章草稿(articles):編輯器裡尚未按「儲存」的 title/lede/blocks/palette。key = 使用者 scope + (文章 slug 或
//    NEW_ARTICLE_KEY)。與後端的 status:'draft'(已存到伺服器、未發布)是兩回事,這裡是「連儲存都還沒按」的本機暫存。
// 2. 待上傳圖片(photos):選好檔案、前端縮圖完成但尚未上傳的圖片(原檔 File + 三種縮圖 Blob + 辨識備註)。
//    重新整理或關掉分頁後再回來仍在,不必重選、不必重新辨識。
//
// 所有函式都吞掉錯誤(無痕模式、瀏覽器封鎖儲存、配額已滿、舊瀏覽器沒有 IndexedDB):草稿是附加便利,
// 失敗只代表「沒存到」,不能影響編輯與上傳本身。讀取失敗回空值,寫入失敗回 false。
//
// scope:同一個瀏覽器可能換帳號,key 前綴用 token 的 JWT sub(解不出來退回 'anon'),避免 A 帳號的草稿出現在 B 帳號。
// 這不是安全邊界(資料都在使用者自己的瀏覽器裡),只是避免誤還原到別人的內容。
import type { PhotoVariantKind } from './photoVariants'

const DB_NAME = 'tripace-blog-drafts'
const DB_VERSION = 1
const STORE_ARTICLES = 'articles'
const STORE_PHOTOS = 'photos'

export const NEW_ARTICLE_KEY = '__new__'

export interface ArticleDraft {
  title: string
  lede: string
  blocks: unknown[]
  palette?: string
  savedAt: number
}

export interface StagedPhotoDraft {
  key: string
  file: File
  variants: Record<PhotoVariantKind, Blob>
  note?: string
  savedAt: number
}

// draftScope:從 JWT 取 sub 當 scope;沒有 token 或格式不對退回 'anon'。
export function draftScope(token: string | null | undefined): string {
  if (!token) return 'anon'
  try {
    const part = token.split('.')[1]
    if (!part) return 'anon'
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub !== '' ? sub : 'anon'
  } catch {
    return 'anon'
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_ARTICLES)) db.createObjectStore(STORE_ARTICLES)
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

// run:在單一 transaction 裡執行 fn,回傳 fn 設定的結果;任何失敗(含 transaction abort、配額)回 fallback。
async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, done: (v: T) => void) => void,
  fallback: T,
): Promise<T> {
  const db = await openDB()
  if (!db) return fallback
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction(storeName, mode)
      let result = fallback
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => resolve(fallback)
      tx.onabort = () => resolve(fallback)
      fn(tx.objectStore(storeName), (v) => {
        result = v
      })
    } catch {
      resolve(fallback)
    }
  })
}

function articleKey(scope: string, slugKey: string): string {
  return `${scope}:${slugKey}`
}

export function saveArticleDraft(scope: string, slugKey: string, draft: ArticleDraft): Promise<boolean> {
  return run<boolean>(
    STORE_ARTICLES,
    'readwrite',
    (store, done) => {
      store.put(draft, articleKey(scope, slugKey))
      done(true)
    },
    false,
  )
}

export function loadArticleDraft(scope: string, slugKey: string): Promise<ArticleDraft | null> {
  return run<ArticleDraft | null>(
    STORE_ARTICLES,
    'readonly',
    (store, done) => {
      const req = store.get(articleKey(scope, slugKey))
      req.onsuccess = () => done((req.result as ArticleDraft | undefined) ?? null)
    },
    null,
  )
}

export function deleteArticleDraft(scope: string, slugKey: string): Promise<boolean> {
  return run<boolean>(
    STORE_ARTICLES,
    'readwrite',
    (store, done) => {
      store.delete(articleKey(scope, slugKey))
      done(true)
    },
    false,
  )
}

function photoKey(scope: string, key: string): string {
  return `${scope}:${key}`
}

export function saveStagedPhoto(scope: string, item: StagedPhotoDraft): Promise<boolean> {
  return run<boolean>(
    STORE_PHOTOS,
    'readwrite',
    (store, done) => {
      store.put(item, photoKey(scope, item.key))
      done(true)
    },
    false,
  )
}

export function deleteStagedPhoto(scope: string, key: string): Promise<boolean> {
  return run<boolean>(
    STORE_PHOTOS,
    'readwrite',
    (store, done) => {
      store.delete(photoKey(scope, key))
      done(true)
    },
    false,
  )
}

// loadStagedPhotos:取回這個 scope 的全部待上傳圖片,依存入時間排序。
export function loadStagedPhotos(scope: string): Promise<StagedPhotoDraft[]> {
  const prefix = `${scope}:`
  return run<StagedPhotoDraft[]>(
    STORE_PHOTOS,
    'readonly',
    (store, done) => {
      const req = store.getAll(IDBKeyRange.bound(prefix, prefix + '￿'))
      req.onsuccess = () => {
        const list = (req.result as StagedPhotoDraft[]).filter(
          (d) => d && d.file instanceof Blob && d.variants && variantsComplete(d.variants),
        )
        done(list.sort((a, b) => a.savedAt - b.savedAt))
      }
    },
    [],
  )
}

// variantsComplete:資料毀損(例如寫到一半被中斷)時,缺任何一種縮圖的紀錄不還原。
function variantsComplete(v: Record<string, unknown>): boolean {
  return v.thumbnail instanceof Blob && v.large instanceof Blob && v.llm instanceof Blob
}
