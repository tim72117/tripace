import type { Drawable, FeatureLayer } from './types'

// composeLayers——把多個功能層組合成宿主要畫的一份清單。純函式。
//
// 每個項目的 id 加上功能層 id 當前綴(`${layerId}:${id}`),所以不同功能層可以各自使用相同的 id
// 而不互相衝突,宿主也能只更新某個功能層的項目、不動其他功能層。marker 的 onClick 會被包一層,
// 讓功能層收到的仍然是自己原本的 id(不含前綴)。回傳新物件,不改動原本的 drawable。
export function composeLayers(layers: FeatureLayer[]): Drawable[] {
  const out: Drawable[] = []
  for (const layer of layers) {
    for (const d of layer.drawables) {
      const prefixed = `${layer.id}:${d.id}`
      if (d.kind === 'marker' && d.onClick) {
        const original = d.onClick
        out.push({ ...d, id: prefixed, onClick: () => original(d.id) })
      } else {
        out.push({ ...d, id: prefixed })
      }
    }
  }
  return out
}
