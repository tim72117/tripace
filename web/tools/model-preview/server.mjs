// server.mjs——模型預覽伺服器(獨立工具,不屬於主網站,不進正式建置)。
//
// 監看一個資料夾裡的 .glb(預設 tools/blender/out/),檔案一寫完就透過 SSE 通知瀏覽器重新載入。
// 零依賴:只用 Node 內建模組;three 直接從 node_modules 以 importmap 提供給瀏覽器。
// 用法:node tools/model-preview/server.mjs [模型資料夾]    環境變數 PORT(預設 5190)
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, watch } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const webRoot = resolve(here, '..', '..')
const modelsDir = resolve(process.argv[2] ?? join(webRoot, 'tools', 'blender', 'out'))
const threeDir = join(webRoot, 'node_modules', 'three')
const port = Number(process.env.PORT ?? 5190)
mkdirSync(modelsDir, { recursive: true })

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' }

// 只提供 root 之內的檔案(擋掉 .. 與符號路徑跳出)
function safeJoin(root, rel) {
  const full = normalize(join(root, rel))
  return full === root || full.startsWith(root + sep) ? full : null
}

function serveFile(res, file, extra = {}) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', ...extra })
  createReadStream(file).pipe(res)
}

const listModels = () =>
  readdirSync(modelsDir).filter((f) => f.endsWith('.glb')).map((name) => {
    const s = statSync(join(modelsDir, name))
    return { name, size: s.size, mtime: s.mtimeMs }
  }).sort((a, b) => b.mtime - a.mtime)

const listImages = () =>
  readdirSync(modelsDir).filter((f) => f.endsWith('.png')).map((name) => {
    const st = statSync(join(modelsDir, name))
    return { name, size: st.size, mtime: st.mtimeMs }
  }).sort((a, b) => b.mtime - a.mtime)

const clients = new Set()
const push = (data) => { for (const c of clients) c.write(`data: ${JSON.stringify(data)}\n\n`) }

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const p = decodeURIComponent(url.pathname)
  if (p === '/' || p === '/index.html') return serveFile(res, join(here, 'index.html'))
  if (p === '/vista') return serveFile(res, join(here, 'vista.html'))
  if (p === '/vista3d') return serveFile(res, join(here, 'vista3d.html'))
  if (p === '/viewer.js') return serveFile(res, join(here, 'viewer.js'))
  if (p === '/api/models') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(listModels())); return }
  if (p === '/api/images') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(listImages())); return }
  if (p.startsWith('/models/')) return serveFile(res, safeJoin(modelsDir, p.slice('/models/'.length)))
  if (p.startsWith('/vendor/three/')) return serveFile(res, safeJoin(threeDir, p.slice('/vendor/three/'.length)))
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write('retry: 1000\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  res.writeHead(404).end('not found')
})

// 檔案監看:匯出器是分段寫入的,所以等大小連續兩次相同(穩定)才通知,避免瀏覽器讀到寫到一半的 GLB
const pending = new Map()
function settle(name, type = 'change') {
  clearTimeout(pending.get(name))
  let last = -1
  const tick = () => {
    const file = join(modelsDir, name)
    if (!existsSync(file)) { push({ type: 'remove', name }); pending.delete(name); return }
    const size = statSync(file).size
    if (size === last && size > 0) { pending.delete(name); push({ type, name, size, at: Date.now() }); return }
    last = size
    pending.set(name, setTimeout(tick, 120))
  }
  pending.set(name, setTimeout(tick, 120))
}
watch(modelsDir, (_event, name) => {
  const n = String(name ?? '')
  if (n.endsWith('.glb')) settle(n)
  else if (n.endsWith('.png')) settle(n, 'image') // 渲染圖(如遠景 /vista)
})
setInterval(() => push({ type: 'ping' }), 15000) // 讓代理或瀏覽器不要把閒置連線切掉

server.listen(port, '127.0.0.1', () => {
  console.log(`模型預覽:http://localhost:${port}`)
  console.log(`監看資料夾:${modelsDir}`)
})
