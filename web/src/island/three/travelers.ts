// travelers.ts——親子兩人沿步道走(原型:沿曲線按時間表走,沒有尋路與互動)。
import * as THREE from 'three'
import type { PathCurve } from '../logic/pathCurve'
import { animateModel, buildModel, type BuiltModel, type Model3D } from './model'

type Walker = { built: BuiltModel; scale: number; phase: number; weight: number; lastArc: number; lateral: number; behind: number }

export type Travelers = {
  group: THREE.Group
  update(arc: number, time: number): void
}

export function buildTravelers(
  parent: Model3D,
  child: Model3D,
  curve: PathCurve,
  heightAtArc: (s: number) => number,
): Travelers {
  const group = new THREE.Group()
  const mk = (m: Model3D, scale: number, lateral: number, behind: number): Walker => {
    const built = buildModel(m)
    built.root.scale.setScalar(scale)
    built.root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.castShadow = true })
    group.add(built.root)
    return { built, scale, phase: 0, weight: 0, lastArc: 0, lateral, behind }
  }
  const walkers = [mk(parent, 1.7, -0.45, 0), mk(child, 1.7, 0.5, 0.9)]
  let first = true

  return {
    group,
    update(arc, time) {
      for (const w of walkers) {
        const s = Math.max(0, Math.min(curve.length, arc - w.behind))
        const p = curve.at(s)
        // 側移:垂直於前進方向
        const x = p.x + -p.dirZ * w.lateral
        const z = p.z + p.dirX * w.lateral
        w.built.root.position.set(x, heightAtArc(s), z)
        w.built.root.rotation.y = Math.atan2(p.dirX, p.dirZ)
        const moved = first ? 0 : Math.abs(s - w.lastArc)
        w.lastArc = s
        // 走路週期:每走一個 stride 完成一次擺動;停下來時權重漸漸歸零,四肢回到原位
        w.phase += (moved / (w.built.stride * w.scale)) * Math.PI * 2
        w.weight += ((moved > 0.002 ? 1 : 0) - w.weight) * 0.2
        animateModel(w.built, w.phase, w.weight, time)
      }
      first = false
    },
  }
}
