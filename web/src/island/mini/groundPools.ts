// groundPools.ts——地面光斑:每盞燈/每棟建築底下貼在地面的一圈暖色光暈,像燈光灑在石板與草地上。
//
// 縮小版沒有陰影、PointLight 也只有少數幾盞,光靠它們照不出「每盞燈都把周圍照亮」的感覺;
// 光斑用一個 InstancedMesh(單次繪製呼叫)補上這一層。平躺在地面、加法混合、不寫深度,
// 不會遮擋任何東西,也不受光照影響(自發光)。強度由主題決定(logic/mini.ts miniGlow.groundPool)。
import * as THREE from 'three'
import { poolRadius } from '../logic/mini'
import { glowSpriteTexture } from '../three/lanterns'
import type { LampSource } from '../three/scatter'

export type GroundPools = { mesh: THREE.InstancedMesh | null; setOpacity(o: number): void; count: number }

export function buildGroundPools(sources: ReadonlyArray<LampSource>): GroundPools {
  const total = sources.reduce((n, s) => n + s.matrices.length, 0)
  if (total === 0) return { mesh: null, setOpacity() {}, count: 0 }
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    map: glowSpriteTexture(), color: '#ff9a3c', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, total)
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3()
  const m = new THREE.Matrix4()
  let i = 0
  for (const src of sources) {
    for (const placement of src.matrices) {
      placement.decompose(pos, quat, scl)
      const r = poolRadius(scl.x)
      mesh.setMatrixAt(i++, m.compose(new THREE.Vector3(pos.x, pos.y + 0.12, pos.z), new THREE.Quaternion(), new THREE.Vector3(r * 2, 1, r * 2)))
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  mesh.visible = false
  return {
    mesh,
    count: total,
    setOpacity(o) { mat.opacity = Math.max(0, Math.min(1, o)); mesh.visible = o > 0 },
  }
}
