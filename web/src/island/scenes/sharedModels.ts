// sharedModels.ts——跨場景共用的模型(src/island/models/*.ts:樹、石、燈籠、旅人等)的載入器。
// 不是 eager:只有某個場景的版面用到哪個模型,才會載入哪個(見 modelIds.ts 的 neededModelIds)。
// 場景專屬的模型放在 scenes/<id>/models/,由該場景的 data.ts 提供載入器。
import type { Model3D } from '../three/model'

export const SHARED_MODEL_LOADERS = import.meta.glob<Model3D>('../models/*.ts', { import: 'default' })
