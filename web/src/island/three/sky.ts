// sky.ts——天空漸層球、星星。放在場景內(而不是 CSS 背景):分享截圖只有 WebGL 內容,
// CSS 背景不會進圖,放進場景一次解決。
import * as THREE from 'three'
import type { LightState } from '../logic/lighting'

export type Sky = {
  group: THREE.Group
  update(light: LightState, sunDir: THREE.Vector3): void
}

export function buildSky(starCount: number): Sky {
  const group = new THREE.Group()
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#223') },
      bottom: { value: new THREE.Color('#446') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#fff') },
      sunGlow: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow;
      void main(){
        float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.8));
        float s = max(dot(vDir, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 24.0) * 0.55 + pow(s, 6.0) * 0.18) * sunGlow;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(625, 32, 16), mat)
  dome.renderOrder = -10
  group.add(dome)

  // 星星:上半球的點,夜間才顯示
  const pos = new Float32Array(starCount * 3)
  let seed = 12345
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let i = 0; i < starCount; i++) {
    const a = rnd() * Math.PI * 2
    const e = Math.acos(1 - rnd() * 0.85) // 偏向天頂
    pos.set([Math.sin(e) * Math.cos(a) * 380, Math.cos(e) * 380, Math.sin(e) * Math.sin(a) * 380], i * 3)
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false })
  group.add(new THREE.Points(sg, starMat))

  return {
    group,
    update(light, sunDir) {
      mat.uniforms.top.value.set(light.skyTop)
      mat.uniforms.bottom.value.set(light.skyBottom)
      mat.uniforms.sunDir.value.copy(sunDir)
      mat.uniforms.sunColor.value.set(light.sun)
      // 太陽在地平線附近(仰角 -5°~25°)暈染最明顯;夜間月光暈較淡
      const elev = light.sunElevationDeg
      mat.uniforms.sunGlow.value = Math.max(0, Math.min(1, 1 - Math.abs(elev - 8) / 24)) * Math.min(1, light.sunIntensity / 1.5 + 0.25)
      starMat.opacity = Math.max(0, Math.min(1, (1.1 - light.sunIntensity) * 1.2))
    },
  }
}
