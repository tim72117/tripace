import { describe, expect, it } from 'vitest'
import { circleHitsPoly, convexHull, createColliderIndex, pushTrail, steerToward, trailPointBehind, tryStep, type WalkWorld } from './walk'

describe('convexHull', () => {
  it('取最外圈,內部點與共線點被丟掉', () => {
    const h = convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [2, 0]])
    expect(h).toHaveLength(4)
    expect(h).not.toContainEqual([2, 2])
  })
})

describe('circleHitsPoly', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]] as Array<[number, number]>
  it('圓心在內、圓與邊相交 = 撞;離開一個半徑以上 = 不撞', () => {
    expect(circleHitsPoly(2, 2, 0.3, sq)).toBe(true)
    expect(circleHitsPoly(4.2, 2, 0.3, sq)).toBe(true)
    expect(circleHitsPoly(4.5, 2, 0.3, sq)).toBe(false)
    expect(circleHitsPoly(5, 5, 0.3, sq)).toBe(false)
  })
})

describe('createColliderIndex', () => {
  it('只在附近的多邊形裡找,遠處不撞', () => {
    const idx = createColliderIndex([[[0, 0], [2, 0], [2, 2], [0, 2]], [[50, 50], [52, 50], [52, 52], [50, 52]]])
    expect(idx.hits(1, 1, 0.3)).toBe(true)
    expect(idx.hits(51, 51, 0.3)).toBe(true)
    expect(idx.hits(25, 25, 0.3)).toBe(false)
    expect(idx.hits(-0.2, 1, 0.3)).toBe(true)
  })
})

describe('tryStep', () => {
  // 世界:島 [-10,10]²;x>3 是 1 格高的台地(可上),x>6 是 3 格高的牆(上不去);一面 z∈[0,1]、x∈[-2,-1] 的實心牆
  const wall = createColliderIndex([[[-2, 0], [-1, 0], [-1, 1], [-2, 1]]])
  const world: WalkWorld = {
    inside: (x, z) => Math.abs(x) <= 10 && Math.abs(z) <= 10,
    surfaceY: (x) => (x > 6 ? 3 : x > 3 ? 1 : 0),
    blocked: (x, z, r) => wall.hits(x, z, r),
  }
  const o = { radius: 0.3, maxStep: 0.7 }
  const at = (x: number, z: number) => ({ x, z, y: world.surfaceY(x, z) })

  it('平地直走', () => {
    const r = tryStep(world, o, at(0, 5), 0.5, 0)
    expect(r.moved).toBe(true)
    expect(r.x).toBeCloseTo(0.5)
  })
  it('高度差超過 maxStep(牆面、斷崖)擋住;小於的可以上下', () => {
    expect(tryStep(world, o, at(2.8, 5), 0.5, 0).moved).toBe(false) // 0 → 1,落差 1 > 0.7
    expect(tryStep(world, { ...o, maxStep: 1.2 }, at(2.8, 5), 0.5, 0).moved).toBe(true)
    expect(tryStep(world, o, at(5.8, 5), 0.5, 0).y).toBe(1) // 平台內 1 → 1 可以
    expect(tryStep(world, o, at(5.8, 5), 0.5, 0).moved).toBe(false) // 1 → 3 擋住
  })
  it('撞到固體會沿牆滑(斜著走時留下沒被擋的那個軸)', () => {
    const r = tryStep(world, o, at(-3, 0.5), 0.8, 0.2) // 往東會撞牆;只走 z 仍可
    expect(r.moved).toBe(true)
    expect(r.x).toBe(-3)
    expect(r.z).toBeCloseTo(0.7)
  })
  it('完全被擋就停住;出島邊界也算擋', () => {
    expect(tryStep(world, o, at(-2.7, 0.5), 0.5, 0).moved).toBe(false)
    expect(tryStep(world, o, at(9.8, 0), 0.5, 0).moved).toBe(false)
  })
})

describe('steerToward', () => {
  it('每次最多走 step,接近目標時不衝過頭並標記到達', () => {
    expect(steerToward([0, 0], [10, 0], 1)).toEqual({ dx: 1, dz: 0, arrived: false })
    const near = steerToward([0, 0], [0.5, 0], 1)
    expect(near.dx).toBeCloseTo(0.5)
    expect(near.arrived).toBe(true)
    expect(steerToward([1, 1], [1, 1], 1).arrived).toBe(true)
  })
})

describe('軌跡跟隨', () => {
  it('pushTrail 太近的點不加、超過上限丟最舊的', () => {
    const t: Array<[number, number]> = []
    pushTrail(t, [0, 0]); pushTrail(t, [0.05, 0]); pushTrail(t, [1, 0])
    expect(t).toHaveLength(2)
    for (let i = 0; i < 400; i++) pushTrail(t, [i + 2, 0], 0.15, 50)
    expect(t).toHaveLength(50)
  })
  it('trailPointBehind 沿軌跡往回走指定距離;軌跡不夠長回傳最舊點', () => {
    const t: Array<[number, number]> = [[0, 0], [3, 0], [3, 4]]
    expect(trailPointBehind(t, 2)).toEqual([3, 2])
    const p = trailPointBehind(t, 5)
    expect(p[0]).toBeCloseTo(2)
    expect(p[1]).toBeCloseTo(0)
    expect(trailPointBehind(t, 99)).toEqual([0, 0])
    expect(trailPointBehind([], 1)).toEqual([0, 0])
  })
})
