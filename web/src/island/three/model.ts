// 沿用 /Users/caitingyu/Documents/imagine 的 src/three/model.ts(feat/3d-prototype 分支)的宣告式低多邊形模型格式。
// 這份是複本,獨立於 imagine 專案;格式是這個目錄所有模型檔的契約,改動前要同步所有 src/models/*.ts。

import * as THREE from 'three';

// 3D 素材格式：宣告式的 low-poly 模型，由基本幾何組成，可由 AI（Fable）直接撰寫。
//
// 座標約定：
//   - 1 單位 = 物件的 size（與 2D sprite 寬度相同，spawn 時的 size 參數）
//   - +Y 向上，原點在腳底地面中心，模型正面朝 +Z
//   - rotation 為弧度（Euler XYZ）
//   - color 可直接寫 '#rrggbb'，或寫 '$name' 引用 palette

export type Vec3 = [number, number, number];

export type Shape =
  | { type: 'box'; size: Vec3 }
  | { type: 'sphere'; radius: number; detail?: number }   // icosahedron，detail 0~2（越高越圓）
  | { type: 'dodecahedron'; radius: number }               // 石頭、樹冠
  | { type: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; segments?: number }
  | { type: 'cone'; radius: number; height: number; segments?: number }
  | { type: 'capsule'; radius: number; length: number }
  | { type: 'torus'; radius: number; tube: number; arc?: number };

// 程序動畫：
//   swing — 隨步行週期擺動（四肢），只在移動時作用，靜止時回到原位
//   bob   — 隨步行週期上下彈跳（身體），頻率為步伐兩倍
//   sway  — 依時間持續擺動（樹葉、尾巴、呼吸），不論是否移動
export type Motion =
  | { kind: 'swing'; axis: 'x' | 'y' | 'z'; amplitude: number; phase?: number }
  | { kind: 'bob'; amplitude: number; phase?: number }
  | { kind: 'sway'; axis: 'x' | 'y' | 'z'; amplitude: number; speed?: number; phase?: number };

export type Part = {
  name?: string;
  shape?: Shape;          // 省略 = 空的樞紐節點（用來讓子節點繞關節旋轉）
  color?: string;
  emissive?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  motion?: Motion;
  children?: Part[];
};

export type Model3D = {
  palette?: Record<string, string>;
  // 步長（單位同上）：每走這麼遠完成一次步行週期，預設 0.6
  stride?: number;
  parts: Part[];
};

export type Animated = {
  object: THREE.Object3D;
  motion: Motion;
  base: THREE.Euler;
  baseY: number;
};

export type BuiltModel = {
  root: THREE.Group;
  animated: Animated[];
  stride: number;
};

function buildGeometry(shape: Shape): THREE.BufferGeometry {
  switch (shape.type) {
    case 'box':          return new THREE.BoxGeometry(...shape.size);
    case 'sphere':       return new THREE.IcosahedronGeometry(shape.radius, shape.detail ?? 1);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(shape.radius, 0);
    case 'cylinder':     return new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments ?? 8);
    case 'cone':         return new THREE.ConeGeometry(shape.radius, shape.height, shape.segments ?? 8);
    case 'capsule':      return new THREE.CapsuleGeometry(shape.radius, shape.length, 3, 8);
    case 'torus':        return new THREE.TorusGeometry(shape.radius, shape.tube, 6, 12, shape.arc ?? Math.PI * 2);
  }
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function material(color: string, emissive?: string): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive ?? ''}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0 });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.6; }
    materialCache.set(key, m);
  }
  return m;
}

export function buildModel(model: Model3D): BuiltModel {
  const animated: Animated[] = [];
  const resolve = (c: string | undefined) =>
    c?.startsWith('$') ? model.palette?.[c.slice(1)] ?? '#ff00ff' : c ?? '#cccccc';

  const build = (part: Part): THREE.Object3D => {
    const obj: THREE.Object3D = part.shape
      ? new THREE.Mesh(buildGeometry(part.shape), material(resolve(part.color), part.emissive && resolve(part.emissive)))
      : new THREE.Group();
    if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; }
    if (part.name) obj.name = part.name;
    if (part.position) obj.position.set(...part.position);
    if (part.rotation) obj.rotation.set(...part.rotation);
    if (part.scale) obj.scale.set(...part.scale);
    if (part.motion) animated.push({ object: obj, motion: part.motion, base: obj.rotation.clone(), baseY: obj.position.y });
    for (const child of part.children ?? []) obj.add(build(child));
    return obj;
  };

  const root = new THREE.Group();
  for (const p of model.parts) root.add(build(p));
  return { root, animated, stride: model.stride ?? 0.6 };
}

// walkPhase：累積步行週期（弧度）；walkWeight：0~1，移動時趨近 1，靜止時趨近 0。
export function animateModel(built: BuiltModel, walkPhase: number, walkWeight: number, time: number) {
  for (const a of built.animated) {
    const m = a.motion;
    const phase = m.phase ?? 0;
    if (m.kind === 'swing') {
      a.object.rotation[m.axis] = a.base[m.axis] + Math.sin(walkPhase + phase) * m.amplitude * walkWeight;
    } else if (m.kind === 'bob') {
      a.object.position.y = a.baseY + Math.abs(Math.sin(walkPhase + phase)) * m.amplitude * walkWeight;
    } else {
      a.object.rotation[m.axis] = a.base[m.axis] + Math.sin(time * (m.speed ?? 1) + phase) * m.amplitude;
    }
  }
}
