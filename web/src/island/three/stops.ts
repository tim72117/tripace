// stops.ts——四站建築、CSS2D 標籤、點選碰撞代理、窗戶/招牌隨燈籠一起亮。
//
// 站點建築數量少(4 棟),直接用 buildModel 的 Group,保留 model.ts 的 sway 動畫(布條、燈籠擺動)。
// 重要:model.ts 的材質是「全域共用快取」(同色同發光色共用一個材質),所以發光部件在這裡先
// clone 材質再調 emissiveIntensity,否則一調就會讓島上所有同色模型一起變亮。
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { IslandStop } from '../logic/articleToIsland'
import { animateModel, buildModel, placementScale, type BuiltModel, type Model3D } from './model'
import { LANTERN_GLOW_BASE, buildStopLanterns, collectLanternAnchors } from './stopLanterns'

export type StopView = {
  index: number
  stop: IslandStop
  root: THREE.Group
  built: BuiltModel
  glowMats: Array<{ m: THREE.MeshStandardMaterial; base: number }>
  label: CSS2DObject
  labelEl: HTMLElement
  center: THREE.Vector3 // 建築包圍盒中心(世界)
  topY: number
}

export type Stops = {
  group: THREE.Group
  views: StopView[]
  update(time: number, glowPerStop: ReadonlyArray<number>, activeIndex: number, selectedIndex: number): void
}

// buildStops——stops 必須是「島上實際顯示的站」(先用 logic/articleToIsland 的 displayableStops 過濾),
// 這樣 views[i].index === i,場景與 HUD 的「第 i 站」才指向同一站。下面對沒有版面/模型的站直接跳過只是最後一道防線。
export function buildStops(
  stops: ReadonlyArray<IslandStop>,
  models: Record<string, Model3D>,
  heightAt: (x: number, z: number) => number,
  onLabelClick: (index: number) => void,
): Stops {
  const group = new THREE.Group()
  const views: StopView[] = []

  stops.forEach((stop, index) => {
    const a = stop.anchor
    if (!a || !models[a.model]) return
    const built = buildModel(models[a.model])
    const root = built.root
    const sc = placementScale(models[a.model], a.scale)
    root.scale.setScalar(sc)
    root.rotation.y = a.rotY ?? 0
    root.position.set(a.x, a.y ?? heightAt(a.x, a.z), a.z)
    root.updateMatrixWorld(true)

    const glowMats: StopView['glowMats'] = []
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (mat.emissive && mat.emissive.getHex() !== 0) {
        const c = mat.clone()
        delete c.userData.sharedResource // 複本由這個站點自己擁有(clone 會連 userData 一起複製),卸載時要釋放
        mesh.material = c
        glowMats.push({ m: c, base: mat.emissiveIntensity || 0.6 })
      }
      // 很小的部件不投影,省陰影 pass 的繪製呼叫(0.78 m = 換成 1 格 = 1 m 之前的 0.5 格)
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
      if (Math.max(size.x, size.y, size.z) < 0.78) mesh.castShadow = false
    })
    group.add(root)

    // 建築 GLB 裡的燈籠錨點(lantern_*)→ 用實例畫燈籠(見 stopLanterns.ts);發光燈身一起收進 glowMats,隨站點亮度連動
    const lanterns = buildStopLanterns(collectLanternAnchors(root))
    if (lanterns) {
      group.add(lanterns.group)
      glowMats.push({ m: lanterns.bodyMaterial, base: LANTERN_GLOW_BASE })
    }

    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())

    // 標籤:選站的唯一入口(點建築模型不會選站,見 IslandApp 的點擊處理);只顯示序號與站名,不顯示時間
    // (時間在日夜自動滾動下與畫面無關,示意時間只在資訊卡裡)
    const el = document.createElement('button')
    el.className = 'stop-label'
    el.type = 'button'
    el.innerHTML = `<span class="stop-label-idx">${stop.index || index + 1}</span><span class="stop-label-name">${stop.name}</span>`
    el.addEventListener('click', (e) => { e.stopPropagation(); onLabelClick(index) })
    const label = new CSS2DObject(el)
    label.position.set(center.x, box.max.y + 1.2, center.z)
    group.add(label)

    views.push({ index, stop, root, built, glowMats, label, labelEl: el, center, topY: box.max.y })
  })

  return {
    group,
    views,
    update(time, glowPerStop, activeIndex, selectedIndex) {
      for (const v of views) {
        animateModel(v.built, 0, 0, time)
        const g = glowPerStop[v.index] ?? 0
        // 夜晚放大倍率配合 ACES 色調映射才有「亮」的感覺(數值需看畫面調)
        for (const gm of v.glowMats) gm.m.emissiveIntensity = gm.base * (0.2 + 2.2 * g)
        v.labelEl.classList.toggle('is-active', v.index === activeIndex)
        v.labelEl.classList.toggle('is-selected', v.index === selectedIndex)
      }
    },
  }
}
