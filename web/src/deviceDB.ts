// 裝置端 DB —— 與 server 隔離的本地原話儲存(對齊 iOS LocalStore)。
//
// 架構:sql.js(SQLite WASM,記憶體)+ IndexedDB 持久化。
//   - 原話(message)只存這裡,後端不保存(local-first)。
//   - sql.js 是記憶體 DB,故每次寫入後把整個 DB dump 成 bytes 存進 IndexedDB;
//     啟動時從 IndexedDB 讀回,重建記憶體 DB。
//   - schema 對齊 iOS LocalStore 的 messages 表(id/channel_id/author_id/author_name/text/created_at)。

import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Message } from './types'
import type { TripEntry } from './clienttools/tripEntryTools'

const IDB_NAME = 'channel-device-db'
const IDB_STORE = 'sqlite'
const IDB_KEY = 'messages.sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

-- clienttools 技術可行性驗證用的旅程清單(見 ChatScreen.tsx clientToolsEntries)。
-- 純前端記憶體資料的持久化落地,與後端 entries 表無關、不同步——ClientToolsBridge
-- 每次工具執行後回傳的是「整批最新清單」而非單筆增量,故用 replaceTripEntries
-- 整批覆寫而非逐筆 upsert,rowid 隱含順序即維持該次回傳的清單順序。
CREATE TABLE IF NOT EXISTS trip_entries (
  channel_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  time        TEXT NOT NULL,
  note        TEXT NOT NULL,
  PRIMARY KEY (channel_id, id)
);
`

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let ready: Promise<void> | null = null

// ---- IndexedDB 低階存取(只存一塊 SQLite bytes)----

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbLoad(): Promise<Uint8Array | null> {
  const idb = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSave(bytes: Uint8Array): Promise<void> {
  const idb = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---- 初始化 ----

// init 載入 sql.js、從 IndexedDB 還原既有 DB(或建新的),套用 schema。
// 多次呼叫共用同一個 Promise(冪等)。
export function initDeviceDB(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const saved = await idbLoad().catch(() => null)
    db = saved ? new SQL.Database(saved) : new SQL.Database()
    db.run(SCHEMA)
  })()
  return ready
}

// persist 把目前記憶體 DB dump 成 bytes 存進 IndexedDB。
async function persist(): Promise<void> {
  if (!db) return
  await idbSave(db.export())
}

// ---- 原話讀寫 API ----

// saveMessage 寫入(或覆寫)一則原話,並持久化。
export async function saveMessage(m: Message): Promise<void> {
  await initDeviceDB()
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO messages (id, channel_id, author_id, author_name, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [m.id, m.channelID, m.authorID, m.authorName, m.text, m.createdAt],
  )
  await persist()
}

// listMessages 回傳某頻道的原話,依時間舊到新。
export async function listMessages(channelID: string): Promise<Message[]> {
  await initDeviceDB()
  if (!db) return []
  const res = db.exec(
    `SELECT id, channel_id, author_id, author_name, text, created_at
     FROM messages WHERE channel_id = ? ORDER BY created_at ASC`,
    [channelID],
  )
  if (res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    channelID: row[1] as string,
    authorID: row[2] as string,
    authorName: row[3] as string,
    text: row[4] as string,
    createdAt: row[5] as string,
  }))
}

// ---- 旅程清單(clienttools 技術可行性驗證用)讀寫 API ----

// replaceTripEntries 用給定的整批清單覆寫某頻道目前存的旅程清單(先刪舊、
// 再依序插入新的)。呼叫端(ChatScreen 的 onEntriesChange)每次拿到的都是
// ClientToolsBridge 回傳的完整最新清單,不是單筆增量,故用整批覆寫而非逐筆
// upsert——這樣才能正確反映刪除(清單裡消失的那筆會在覆寫時一併被移除)。
export async function replaceTripEntries(channelID: string, entries: TripEntry[]): Promise<void> {
  await initDeviceDB()
  if (!db) return
  db.run('DELETE FROM trip_entries WHERE channel_id = ?', [channelID])
  for (const e of entries) {
    db.run(
      `INSERT INTO trip_entries (channel_id, id, title, date, time, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [channelID, e.id, e.title, e.date, e.time, e.note],
    )
  }
  await persist()
}

// listTripEntries 回傳某頻道目前存的旅程清單,依寫入順序(rowid)。
export async function listTripEntries(channelID: string): Promise<TripEntry[]> {
  await initDeviceDB()
  if (!db) return []
  const res = db.exec(
    `SELECT id, title, date, time, note FROM trip_entries WHERE channel_id = ? ORDER BY rowid ASC`,
    [channelID],
  )
  if (res.length === 0) return []
  return res[0].values.map((row) => ({
    id: row[0] as string,
    title: row[1] as string,
    date: row[2] as string,
    time: row[3] as string,
    note: row[4] as string,
  }))
}
