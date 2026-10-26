// capture.ts——分享用截圖:把 WebGL 畫面加上重畫的站名標籤與署名浮水印,輸出 PNG。
//
// WebGL canvas 預設在合成後會清掉繪圖緩衝,所以必須在「同一個同步呼叫」內 render 完立刻讀取
// (不需要 preserveDrawingBuffer)。CSS2D 標籤不在 canvas 裡,這裡用 2D context 依投影位置重畫。
import * as THREE from 'three'

export type CaptureMeta = { title: string; byline: string; brand: string }
export type LabelSpot = { text: string; position: THREE.Vector3 }

export function captureImage(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  labels: ReadonlyArray<LabelSpot>,
  meta: CaptureMeta,
): Promise<Blob | null> {
  renderer.render(scene, camera)
  const src = renderer.domElement
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const g = out.getContext('2d')!
  g.drawImage(src, 0, 0)

  const k = out.width / Math.max(1, src.clientWidth) // 螢幕像素 → 輸出像素
  g.font = `600 ${Math.round(13 * k)}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`
  g.textBaseline = 'middle'
  const v = new THREE.Vector3()
  for (const l of labels) {
    v.copy(l.position).project(camera)
    if (v.z > 1) continue
    const x = ((v.x + 1) / 2) * out.width
    const y = ((1 - v.y) / 2) * out.height
    const w = g.measureText(l.text).width + 18 * k
    g.fillStyle = 'rgba(20,16,30,0.72)'
    g.beginPath()
    g.roundRect(x - w / 2, y - 12 * k, w, 24 * k, 12 * k)
    g.fill()
    g.fillStyle = '#ffe3b0'
    g.textAlign = 'center'
    g.fillText(l.text, x, y)
  }

  // 底部署名條
  const barH = Math.round(out.height * 0.11)
  const grad = g.createLinearGradient(0, out.height - barH * 1.6, 0, out.height)
  grad.addColorStop(0, 'rgba(10,8,20,0)')
  grad.addColorStop(1, 'rgba(10,8,20,0.78)')
  g.fillStyle = grad
  g.fillRect(0, out.height - barH * 1.6, out.width, barH * 1.6)
  g.textAlign = 'left'
  g.fillStyle = '#fff'
  g.font = `700 ${Math.round(20 * k)}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`
  g.fillText(meta.title, 22 * k, out.height - barH * 0.62)
  g.font = `500 ${Math.round(13 * k)}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`
  g.fillStyle = 'rgba(255,255,255,0.78)'
  g.fillText(meta.byline, 22 * k, out.height - barH * 0.28)
  g.textAlign = 'right'
  g.font = `700 ${Math.round(16 * k)}px Georgia, "Times New Roman", serif`
  g.fillStyle = '#ffc15a'
  g.fillText(meta.brand, out.width - 22 * k, out.height - barH * 0.4)

  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'))
}
