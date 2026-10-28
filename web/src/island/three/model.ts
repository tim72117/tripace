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
  | { type: 'torus'; radius: number; tube: number; arc?: number }
  // 山牆屋頂(三角柱):原點在底面中心(y 0 → height 往上),屋脊沿 X;span = 前後(Z)跨距,length = 沿 X 的長度。
  | { type: 'prism'; span: number; height: number; length: number }
  // 旋轉體(燈籠、陶壺、柱頭):profile 是 [半徑, 高度] 的折線,繞 Y 軸旋轉;法線平滑,適合搭配 smooth。
  | { type: 'lathe'; profile: Array<[number, number]>; segments?: number }
  // 擠出輪廓:outline 是 XY 平面的閉合多邊形,沿 Z 擠出 depth(Z 置中);bevel > 0 時邊緣倒角,輪廓不再生硬。
  | { type: 'extrude'; outline: Array<[number, number]>; depth: number; bevel?: number };

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
  smooth?: boolean;       // 平滑著色(預設平面稜面):圓形物件(燈籠、陶壺、球)用
  rough?: number;         // 粗糙度 0~1(預設 0.85):瓦片、金屬、陶器各有不同
  metal?: number;         // 金屬度 0~1(預設 0)
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  motion?: Motion;
  children?: Part[];
};

// glb:外部建模(Blender 腳本)產出的高細節版本,載入後掛在這裡;有 glb 時畫面用它,parts 只是載入失敗或
// 還沒載入時的後備(宣告式的簡化版)。unit = 把 glb 的單位(公尺)縮成這個模型的單位(parts 的尺寸慣例),
// 這樣版面裡的 scale 不用跟著改。見 three/glbLoader.ts 與 scenes/registry.ts。
export type GlbAttachment = { scene: THREE.Object3D; unit: number };

export type Model3D = {
  glb?: GlbAttachment;
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
    case 'prism':        return prismGeometry(shape.span, shape.height, shape.length);
    case 'lathe':        return new THREE.LatheGeometry(shape.profile.map(([r, y]) => new THREE.Vector2(r, y)), shape.segments ?? 12);
    case 'extrude':      return extrudeGeometry(shape.outline, shape.depth, shape.bevel ?? 0);
  }
}

// 三角柱:非索引三角形(每面各自的法線,稜線才銳利)。截面在 YZ 平面:底邊 z ∈ [-span/2, span/2],頂點在 (0, height)。
export function prismGeometry(span: number, height: number, length: number): THREE.BufferGeometry {
  const hz = span / 2, hx = length / 2
  const A: Vec3 = [-hx, 0, -hz], B: Vec3 = [-hx, 0, hz], C: Vec3 = [-hx, height, 0]
  const D: Vec3 = [hx, 0, -hz], E: Vec3 = [hx, 0, hz], F: Vec3 = [hx, height, 0]
  // 每個三角形的頂點順序要讓法線朝外(three 預設只畫逆時針的正面,朝內的面從外面看會被剔除)。
  const tris: Vec3[][] = [
    [A, B, C], [D, F, E], // 兩端山牆(-X 端朝 -X、+X 端朝 +X)
    [A, F, D], [A, C, F], // -Z 側屋面
    [B, F, C], [B, E, F], // +Z 側屋面
    [A, E, B], [A, D, E], // 底面(朝下)
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3))
  g.computeVertexNormals()
  return g
}

function extrudeGeometry(outline: Array<[number, number]>, depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  // 倒角會讓總厚度多出 2×bevelThickness,所以先扣掉;幾何的 z 範圍是 [-bevel, core + bevel](core = 扣掉後的厚度),
  // 中心在 core/2——要平移的是 core/2,不是 depth/2(兩者只在沒倒角時相等),才會真的置中於 ±depth/2。
  // 注意:bevelSize 也會讓輪廓在平面方向向外擴 bevel(厚度補償只處理 z 方向)。
  const core = bevel > 0 ? Math.max(0.0001, depth - bevel * 2) : depth
  const geo = new THREE.ExtrudeGeometry(shape, bevel > 0
    ? { depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 }
    : { depth, bevelEnabled: false, steps: 1 })
  geo.translate(0, 0, -core / 2)
  return geo
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

// 材質選項:只有被明確指定的值才記在 userData.explicit(烘焙時據此分組,沒指定的沿用各使用處自己的預設)
export type MaterialOpts = { smooth?: boolean; rough?: number; metal?: number };

function material(color: string, emissive?: string, o: MaterialOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive ?? ''}|${o.smooth ? 's' : ''}|${o.rough ?? ''}|${o.metal ?? ''}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: !o.smooth, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0 });
    m.userData.explicit = { smooth: !!o.smooth, rough: o.rough, metal: o.metal };
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
      ? new THREE.Mesh(buildGeometry(part.shape), material(resolve(part.color), part.emissive && resolve(part.emissive), { smooth: part.smooth, rough: part.rough, metal: part.metal }))
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
  if (model.glb) {
    // 高細節版:複製一份場景(幾何與材質共用,不重複佔記憶體);靜態,沒有程序動畫
    const g = model.glb.scene.clone(true);
    g.scale.setScalar(model.glb.unit);
    root.add(g);
    return { root, animated, stride: model.stride ?? 0.6 };
  }
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
