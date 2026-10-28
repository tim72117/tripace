// types.ts——「場景」的型別契約。
//
// 一座島 = 一個場景(SceneDef)。引擎(three/、logic/、ui/)不認識任何特定場景,只吃 SceneData;
// 場景自己放在 scenes/<id>/,由 registry.ts 登記。新增場景 = 新增一個目錄 + 在 registry 加一行。
//
// 分兩層,載入時機不同:
//   - SceneInfo:輕量描述(同步、不含 three、版面、模型),路由、切換選單、SEO 用。
//   - SceneData:重的部分(版面、文章、模型),進入該場景才用 SceneDef.load() 動態載入。
import type { IslandLayout } from '../data/layoutTypes'
import type { ArticleSource, Byline } from '../logic/articleToIsland'
import type { Model3D } from '../three/model'

// GlbSource——某個模型 id 的高細節 GLB 版本:url 是資產網址(Vite 的 ?url 匯入),unit 見 three/model.ts 的 GlbAttachment。
export type GlbSource = { url: string; unit: number };

export type SceneSeo = { title: string; description: string }

export type SceneInfo = {
  id: string // 同時是網址 slug(/island/<id>),只能用小寫英數與連字號
  label: string // 切換選單上的短名稱
  pageLabel: string // 站台導覽列上的頁名
  ctaLabel: string // 「用 Tripace 排我的……」按鈕文字(不含箭頭)
  seo: SceneSeo
  // 實驗場景:只在對應的編譯時 feature flag 打開時才登記(見 registry.ts),不進 sitemap、不對外。
  experimental?: boolean
}

// 場景模組(scenes/<id>/data.ts)的輸出:版面、文章與場景專屬模型的載入器。
export type SceneModule = {
  layout: IslandLayout
  article: ArticleSource
  byline: Byline
  // 與 layout.path.points 一一對應的腳底高度(階地場景才需要;平地填空陣列)
  pathPointY: number[]
  // 場景專屬模型的載入器(import.meta.glob 的結果,鍵為路徑、值為動態 import)
  modelLoaders: Record<string, () => Promise<Model3D>>
  // 高細節版 GLB(選用):模型 id → GLB。完整版載入後掛到同 id 的宣告式模型上;載入失敗就用宣告式後備,不會壞。
  // 首頁縮小版不載入(用 loadBase),省下首頁的流量。
  glbModels?: Record<string, GlbSource>
}

// 載入完成、可直接交給引擎的場景資料:models 只含這個版面實際用到的模型。
export type SceneData = Omit<SceneModule, 'modelLoaders' | 'glbModels'> & { models: Record<string, Model3D> }

export type SceneDef = SceneInfo & { load: () => Promise<SceneModule> }
