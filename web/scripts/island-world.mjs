// island-world.mjs——執行小島場景的 Node 工具(烘焙等)。用專案現有的 vite 載入 TypeScript,不另外裝執行器。
// 用法:node scripts/island-world.mjs bake <sceneId>
//   bake  執行 scenes/<id>/rules.ts,把程序化擺放依格子寫進 scenes/<id>/world/cells/(手擺的保留)
import { createServer } from 'vite'

const [, , cmd, sceneId] = process.argv
const COMMANDS = { bake: '/src/island/tools/bakeWorld.ts' }
if (!COMMANDS[cmd] || !sceneId) {
  console.error('用法:node scripts/island-world.mjs bake <sceneId>')
  process.exit(1)
}

// configFile: false 不帶入網站的 vite 設定(外掛、代理);cacheDir 獨立,不碰正在跑的 dev server 的依賴快取
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  appType: 'custom',
  cacheDir: 'node_modules/.vite-island-world',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const mod = await server.ssrLoadModule(COMMANDS[cmd])
  const r = await mod.bake(sceneId)
  console.log(`[island-world] ${sceneId}:${r.cells} 格,規則擺放 ${r.rule} 筆、手擺 ${r.hand} 筆`)
} finally {
  await server.close()
}
