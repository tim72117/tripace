"""jiufen_vista.py——九份夜景遠景原型(從山城朝海看:層疊山脊、谷地暖霧、沿海燈串、海面倒影、外海漁火、基隆嶼)。

這是「遠景元素試做」:全部用 Blender 原生物件與 EEVEE 渲染 PNG,用來判斷哪些元素有效、再決定搬進 three.js 的做法。
座標用 Blender 的:Z 向上、相機在原點附近朝 +Y 看、X 往右,單位公尺。
執行:Blender --background --python tools/blender/jiufen_vista.py -- tools/blender/out/jiufen-vista.png [--seed N]
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else 'tools/blender/out/jiufen-vista.png'
SEED = int(ARGS[ARGS.index('--seed') + 1]) if '--seed' in ARGS else 7
RES = (1600, 760)
SPAN = 0.8  # 靜態渲染用的山脊寬度(x/y)。180° 全景資料另外用角度取樣匯出(ridge['arc'])
SEA_LIGHTS = '--sea-lights' in ARGS  # 海面上的光(外海漁火與水面倒影條)預設不做
WITH_GROUND = '--with-ground' in ARGS  # 近景山坡與住宅燈光預設不做(只看遠景)
rnd = random.Random(SEED)

EYE_Z = 70.0  # 觀景點高度(九份山城約海拔 200–300m,這裡只取相對高度)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
engines = [e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [v.identifier for v in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'AgX'
try:
    sc.eevee.taa_render_samples = 48
except Exception:
    pass


# ---------- 雜訊(一維,給山脊剖面)----------
class Noise1D:
    def __init__(self, seed, n=4096):
        r = random.Random(seed)
        self.v = [r.random() for _ in range(n)]
        self.n = n

    def at(self, x):
        i = math.floor(x)
        f = x - i
        a, b = self.v[i % self.n], self.v[(i + 1) % self.n]
        t = f * f * (3 - 2 * f)
        return a + (b - a) * t

    def fbm(self, x, octaves=5):
        s, amp, tot, fq = 0.0, 1.0, 0.0, 1.0
        for _ in range(octaves):
            s += amp * self.at(x * fq)
            tot += amp
            amp *= 0.5
            fq *= 2.03
        return s / tot

    def ridged(self, x, octaves=5):
        s, amp, tot, fq = 0.0, 1.0, 0.0, 1.0
        for _ in range(octaves):
            s += amp * (1 - abs(2 * self.at(x * fq) - 1))
            tot += amp
            amp *= 0.5
            fq *= 2.1
        return s / tot


def lin(c):
    return tuple(c)


def emission_mat(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*color, 1)
    e.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def link(obj):
    sc.collection.objects.link(obj)
    return obj


# ---------- 世界(天空漸層:地平線暮色 → 深藍)----------
def build_sky():
    w = bpy.data.worlds.new('sky')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Incoming'], sep.inputs[0])
    # Incoming 是「從場景指向相機」的方向:天空方向的 Z = -Incoming.Z;地平線 0 → 天頂 1
    neg = nt.nodes.new('ShaderNodeMath')
    neg.operation = 'MULTIPLY'
    neg.inputs[1].default_value = -1.0
    nt.links.new(sep.outputs['Z'], neg.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.0
    mr.inputs['From Max'].default_value = 0.55
    mr.clamp = True
    nt.links.new(neg.outputs[0], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, (0.34, 0.20, 0.34, 1)   # 地平線:紫粉
    el[1].position, el[1].color = 1.0, (0.012, 0.022, 0.085, 1)  # 天頂:深藍
    mid = el.new(0.28)
    mid.color = (0.12, 0.10, 0.26, 1)
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    o = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], o.inputs[0])
    sc.world = w


# ---------- 山脊(剖面帷幕)----------
DATA = {'ridges': [], 'lights': [], 'streaks': [], 'fog': []}  # 同步匯出成 JSON,給瀏覽器版(model-preview 的 /vista3d)用
PROFILES = []  # [(y, x0, x1, 剖面函式)],由遠到近;光點用它判斷會不會被前面的山擋住
HAZE = (0.20, 0.17, 0.34)  # 遠景霧色(偏紫藍,與地平線天空相近)


def g_of(th):
    """角度 → 視角座標 x/y:40° 內就是 tan(與靜態渲染一致),之外改成線性延伸(避免 tan 在 90° 暴增、山形被拉得極細)。"""
    a, c = abs(th), math.radians(40)
    v = math.tan(a) if a <= c else math.tan(c) + (a - c) / math.cos(c) ** 2
    return math.copysign(v, th)


def ridge_layer(name, y, base, amp, color_top, x_range, window, seed, freq=0.0075, haze=HAZE, fade_h=100.0, only=None):
    """y 距離;base 山脊平均高度(世界 Z);window=(x0,x1,soft) 這個範圍內山脊壓低(海灣開口);
    color_top 山頂色;往下漸變成霧色(山腳被霧吃掉)。"""
    nz = Noise1D(seed)
    x0, x1 = x_range
    N = int((x1 - x0) / y * 840)  # 取樣密度與視角成比例(範圍加寬後解析度不變)

    def prof(x, back=False, calm=1.0):
        # 這層的 x 要換成「角度座標」,雜訊頻率才不會隨距離縮放失真
        u = x / y * 1600.0 * calm  # calm < 1:頻率降低、細節層數減少 → 山峰變少、變寬(背後與兩側的山用)
        oct_r, oct_f = (4, 3) if calm >= 1 else (2, 2)
        h = base + amp * (0.1 + 0.9 * (0.55 * nz.ridged(u * freq * 0.8, oct_r) + 0.45 * nz.fbm(u * freq * 0.35 + 50, oct_f)))
        if back and only:
            return -5.0  # 灣內的半島/對岸只在前方,背後沒有
        wa, wb, soft = window[0] * y, window[1] * y, window[2] * y  # 開口以 x/y(視角)為單位,各層才會對齊成同一個海灣
        if soft and wa < x < wb and not back:
            k = min((x - wa) / soft, (wb - x) / soft, 1.0)
            k = k * k * (3 - 2 * k)
            h = h * (1 - k) + (-5.0) * k
        if not only and not back:
            # 前方不要遠山:|x/y| 小於 tan55° 的範圍把山脊壓到海面以下,到 ±90°(g=2.33)才完全出現 → 山只在兩側與背後
            gg = abs(x / y)
            t = min(max((gg - 1.43) / 0.9, 0.0), 1.0)
            m = t * t * (3 - 2 * t)
            h = h * m + (-5.0) * (1 - m)
        if only:
            oa, ob_, osoft = only
            k = min((x - oa) / osoft, (ob_ - x) / osoft, 1.0)
            k = max(k, 0.0)
            k = k * k * (3 - 2 * k)
            h = h * k + (-5.0) * (1 - k)
        return h

    PROFILES.append((y, -2.4 * y, 2.4 * y, prof))  # 遮擋判斷要涵蓋全景範圍(x/y ≤ 2.4),不受網格寬度限制
    bm = bmesh.new()
    top, bot = [], []
    for i in range(N + 1):
        x = x0 + (x1 - x0) * i / N
        top.append(bm.verts.new((x, y, prof(x))))
        bot.append(bm.verts.new((x, y, -40.0)))
    for i in range(N):
        bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    near_layer = y < 2500

    def arc_h(deg):
        # 前半圈(±90°)用原本的山形(含海灣開口);背後(±90°~180°)以 ±90° 為軸鏡射前方山形、不開海灣,
        # 這樣背面是連續的遠山,且 ±180° 接縫處高度相同。
        # 側面到背後(50°→110°)逐漸換成「平緩版」山形(calm=0.35):山峰數量約少 3 倍、較寬。
        th = math.radians(deg)
        w = min(max((abs(deg) - 50.0) / 60.0, 0.0), 1.0)
        w = w * w * (3 - 2 * w)
        if abs(th) <= math.pi / 2:
            g = g_of(th)
            h = prof(y * g) * (1 - w) + prof(y * g, calm=0.35) * w
            return h
        g = g_of(math.copysign(math.pi - abs(th), th))
        h = prof(y * g, back=True) * (1 - w) + prof(y * g, back=True, calm=0.35) * w
        if near_layer:
            # 背後只留遠山:近處的山脊(< 2500 m)從 90° 起往背後逐漸沉入海面,130° 後消失。
            t = min(max((abs(th) - math.pi / 2) / math.radians(40), 0.0), 1.0)
            t = t * t * (3 - 2 * t)
            h = h * (1 - t) + (-5.0) * t
        return h

    arc = [round(arc_h(-180 + k * 0.25), 1) for k in range(1441)]  # θ = -180°…+180°,每 0.25°
    DATA['arcDeg'] = 180
    DATA['ridges'].append({'name': name, 'y': y, 'x0': x0, 'x1': x1, 'heights': [round(v.co.z, 1) for v in top], 'arc': arc,
                           'top': list(color_top), 'haze': list(haze), 'fadeH': fade_h})
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    # 材質:從山腳霧色漸變到山頂色(依物件高度)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.0
    mr.inputs['From Max'].default_value = fade_h
    mr.clamp = True
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (*haze, 1)
    e[1].position, e[1].color = 1.0, (*color_top, 1)
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o.inputs[0])
    ob.data.materials.append(m)
    return nz, (x0, x1), (lambda xx: None)


def profile_height(layer_info, x):
    return None


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def build_ridges():
    near, far = (0.003, 0.005, 0.014), (0.06, 0.07, 0.15)
    specs = [
        # name, y, base, amp, window(開口), seed
        ('r0', 5200, 120, 520, (0, 0, 0), 1),
        ('r1', 4300, 100, 420, (0.40, 2.0, 0.3), 2),
        ('r2', 3400, 70, 330, (0.24, 2.0, 0.3), 3),
        ('r3', 2600, 45, 230, (0.10, 2.0, 0.3), 4),
        ('r4', 1900, 30, 160, (0.0, 2.0, 0.3), 5),
        ('r5', 1300, 26, 120, (-0.08, 2.0, 0.3), 6),
        ('r6', 760, 22, 110, (-0.14, 2.0, 0.3), 7),
    ]
    coasts = [
        # 灣內的半島與對岸:低矮、被霧吃掉大半,燈串沿著它的山腳
        ('c1', 2250, 12, 40, (0, 0, 0), 11, (260, 1250, 160), (0.01, 0.015, 0.035), (0.18, 0.14, 0.3)),
        ('c2', 3300, 10, 55, (0, 0, 0), 12, (900, 2300, 260), (0.02, 0.03, 0.07), (0.24, 0.17, 0.32)),
    ]
    for (name, y, base, amp, window, seed, only, top, haze) in coasts:
        ridge_layer(name, y, base, amp, top, (-y * SPAN, y * SPAN), window, seed, haze=haze, fade_h=(base + amp * 0.5) * 0.9, only=only)
    for i, (name, y, base, amp, window, seed) in enumerate(specs):
        t = i / (len(specs) - 1)
        top = mix(far, near, t ** 0.8)
        # 霧色隨距離:近處偏暗藍、遠處偏地平線的紫粉;山腳淡出的高度 = 山高的 0.55
        haze = mix((0.30, 0.20, 0.34), (0.012, 0.016, 0.04), t ** 0.7)
        ridge_layer(name, y, base, amp, top, (-y * SPAN, y * SPAN), window, seed, haze=haze, fade_h=(base + amp * 0.5) * 0.9)
    # r0 沒有海灣開口:遠方整片山色由天際線決定,讓右邊海平線處留一條缺口,後面另外壓低
    return specs


# ---------- 海面 ----------
def build_sea():
    me = bpy.data.meshes.new('sea')
    bm = bmesh.new()
    s = 30000.0
    vs = [bm.verts.new(p) for p in ((-s, -3000, 0), (s, -3000, 0), (s, 14000, 0), (-s, 14000, 0))]
    bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('sea', me))
    m = bpy.data.materials.new('sea')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.012, 0.028, 0.06, 1)
    b.inputs['Roughness'].default_value = 0.16
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Specular IOR Level'].default_value = 0.8
    # 微細的法線擾動(遠海的粼粼感)
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 0.5
    n.inputs['Detail'].default_value = 6
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.5, 0.012, 1.0)  # 沿視線方向拉長 → 橫向條紋倒影
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs[0], n.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    ob.data.materials.append(m)


# ---------- 光點 ----------
HALO_TEX = None


def halo_material(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'QUADRATIC_SPHERE'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (-0.5, -0.5, 0)
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    # 半徑 0.5 內漸變:用 UV 置中後再放大 2 倍
    mp.inputs['Scale'].default_value = (2, 2, 1)
    mp.inputs['Location'].default_value = (-1, -1, 0)
    nt.links.new(mp.outputs[0], grad.inputs[0])
    mr = nt.nodes.new('ShaderNodeMath')
    mr.operation = 'POWER'
    mr.inputs[1].default_value = 2.2
    nt.links.new(grad.outputs['Fac'], mr.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = strength
    nt.links.new(mr.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], em.inputs['Strength'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix_ = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mr.outputs[0], mix_.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix_.inputs[1])
    nt.links.new(em.outputs[0], mix_.inputs[2])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mix_.outputs[0], o.inputs[0])
    return m


_quad_cache = {}


def quad_mesh(key, w, h, z0=0.0):
    """面朝 -Y(對著相機)的矩形,UV 0..1。z0:底邊高度偏移(0 = 以中心為準,-0.5h → 往下長的倒影)。"""
    if key in _quad_cache:
        return _quad_cache[key]
    me = bpy.data.meshes.new(key)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-w / 2, 0, z0 - h / 2), (w / 2, 0, z0 - h / 2), (w / 2, 0, z0 + h / 2), (-w / 2, 0, z0 + h / 2))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new('UV')
    for lp, uvv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = uvv
    bm.to_mesh(me)
    bm.free()
    _quad_cache[key] = me
    return me


def spot(mat_halo, mat_core, pos, size, halo_k=14.0):
    x, y, z = pos
    DATA['lights'].append([round(x, 1), round(y, 1), round(z, 1), round(size, 3), halo_k, mat_halo.name.replace('halo-', '')])
    # 光暈
    h = bpy.data.objects.new('halo', quad_mesh('halo-unit', 1, 1))
    h.location = pos
    s = size * halo_k
    h.scale = (s, 1, s)
    h.data.materials.clear()
    h.data.materials.append(mat_halo)
    link(h)
    # 光核
    c = bpy.data.objects.new('core', quad_mesh('core-unit', 1, 1))
    c.location = pos
    c.scale = (size, 1, size)
    c.data.materials.append(mat_core)
    link(c)


def streak(mat, pos, w, h):
    """水面倒影:光點正下方往下長的漸淡亮條。"""
    if not SEA_LIGHTS:
        return
    x, y, z = pos
    DATA['streaks'].append([round(x, 1), round(y, 1), round(w, 3), round(h, 2), mat.name.replace('streak-', '')])
    ob = bpy.data.objects.new('streak', quad_mesh(f'streak-{round(w, 2)}-{round(h, 2)}', w, h, z0=0))
    ob.location = (x, y, 0.0 - h * 0.5 + 0.0)
    ob.data.materials.append(mat)
    link(ob)


def streak_material(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    # 縱向:頂端最亮往下漸淡;橫向:中央最亮
    fy = nt.nodes.new('ShaderNodeMath')
    fy.operation = 'POWER'
    nt.links.new(sep.outputs['Y'], fy.inputs[0])
    fy.inputs[1].default_value = 1.8
    cx = nt.nodes.new('ShaderNodeMath')
    cx.operation = 'SUBTRACT'
    cx.inputs[0].default_value = 0.5
    nt.links.new(sep.outputs['X'], cx.inputs[1])
    ab = nt.nodes.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(cx.outputs[0], ab.inputs[0])
    fx = nt.nodes.new('ShaderNodeMath')
    fx.operation = 'MULTIPLY_ADD'
    fx.inputs[1].default_value = -2.0
    fx.inputs[2].default_value = 1.0
    nt.links.new(ab.outputs[0], fx.inputs[0])
    prod = nt.nodes.new('ShaderNodeMath')
    prod.operation = 'MULTIPLY'
    nt.links.new(fy.outputs[0], prod.inputs[0])
    nt.links.new(fx.outputs[0], prod.inputs[1])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = strength
    nt.links.new(prod.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], em.inputs['Strength'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(prod.outputs[0], mx.inputs['Fac'])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mx.outputs[0], o.inputs[0])
    return m


WARM = (1.0, 0.62, 0.22)
WARM2 = (1.0, 0.82, 0.5)
PINK = (1.0, 0.25, 0.3)
WHITE = (0.75, 0.9, 1.0)


def build_lights(ridge_specs):
    halo_warm = halo_material('halo-warm', WARM, 5.0)
    halo_warm2 = halo_material('halo-warm2', WARM2, 5.0)
    halo_pink = halo_material('halo-pink', PINK, 6.0)
    halo_white = halo_material('halo-white', WHITE, 7.0)
    core_warm = halo_material('core-warm', WARM2, 55.0)
    core_pink = halo_material('core-pink', (1.0, 0.5, 0.5), 45.0)
    core_white = halo_material('core-white', (0.9, 0.97, 1.0), 80.0)
    st_warm = streak_material('streak-warm', WARM, 3.0)
    st_pink = streak_material('streak-pink', PINK, 4.0)
    st_white = streak_material('streak-white', WHITE, 5.0)

    def visible(x, y, z):
        """光點在 (x,y,z):前面(y 較小)的任何一層山脊擋住了嗎。"""
        el = (z - EYE_Z) / y
        for (y2, xa, xb, prof) in PROFILES:
            if y2 >= y:
                continue
            x2 = x * y2 / y
            if xa < x2 < xb and (prof(x2) - EYE_Z) / y2 > el - 0.0004:
                return False
        return True

    def scatter(n, y_rng, x_rng, z_rng, tries=60):
        out = []
        for _ in range(n):
            for _t in range(tries):
                y = rnd.uniform(*y_rng)
                x = rnd.uniform(*x_rng) * (y / 2500.0)
                z = z_rng[0] + (z_rng[1] - z_rng[0]) * rnd.random() ** 1.5
                if visible(x, y, z):
                    out.append((x, y, z))
                    break
        return out

    # 沒有山的前方不再憑空散布燈光(scatter 數量 0);燈只放在半島與對岸,見下面的海岸燈串
    for (x, y, z) in scatter(0, (1350, 4600), (-2.3 * 2500, 2.3 * 2500), (1.5, 26)):
        size = y * 0.00055 * (0.6 + rnd.random() * 0.8)
        warm = rnd.random()
        if warm < 0.12:
            spot(halo_pink, core_pink, (x, y, z), size, halo_k=9.0)
        else:
            spot(halo_warm if warm < 0.7 else halo_warm2, core_warm, (x, y, z), size, halo_k=10.0)
        if z < 6 and rnd.random() < 0.6:
            streak(st_pink if warm < 0.12 else st_warm, (x, y - 1.0, 0), size * 1.2, size * (14 + rnd.random() * 24))

    # 沿灣內半島與對岸的山腳燈串(貼著各自剖面的海岸線)
    for (cy, xa, xb, n) in ((2250, 330, 1250, 900), (3300, 900, 2300, 1200)):
        prof = next(p_ for (y_, _a, _b, p_) in PROFILES if y_ == cy)
        for _ in range(n):
            x = rnd.uniform(xa, xb)
            top = prof(x)
            if top < 4:
                continue
            z = rnd.uniform(1.0, min(top * 0.75, 16)) ** 1.0
            if not visible(x, cy, z):
                continue
            size = cy * 0.00055 * (0.6 + rnd.random() * 0.8)
            warm = rnd.random()
            if warm < 0.14:
                spot(halo_pink, core_pink, (x, cy - 1, z), size, halo_k=9.0)
            else:
                spot(halo_warm if warm < 0.7 else halo_warm2, core_warm, (x, cy - 1, z), size, halo_k=10.0)
            if z < 5 and rnd.random() < 0.7:
                streak(st_pink if warm < 0.14 else st_warm, (x, cy - 2.0, 0), size * 1.2, size * (14 + rnd.random() * 24))

    # 外海漁火(白藍光點散在海上)
    for i in range(18 if SEA_LIGHTS else 0):
        y = rnd.uniform(1700, 3900)
        x = rnd.uniform(500, 1750) * (y / 3000)
        if not visible(x, y, 2.5):
            continue
        size = y * 0.0006 * (0.8 + rnd.random() * 0.6)
        spot(halo_white, core_white, (x, y, 2.5), size, halo_k=16.0)
        streak(st_white, (x, y - 1, 0), size * 1.0, size * (24 + rnd.random() * 20))

    # 近景住宅區:在山坡地面上,大小與距離有關
    for i in range(230 if WITH_GROUND else 0):
        x = rnd.uniform(-620, 90)
        y = rnd.uniform(130, 640)
        z = ground_height(x, y)
        if z < 0.5:
            continue
        z += rnd.uniform(0.8, 3.5)
        size = (0.35 + 0.0011 * y) * (0.6 + rnd.random() * 0.8)
        spot(halo_warm if rnd.random() < 0.78 else halo_warm2, core_warm, (x, y, z), size, halo_k=5.0)
        if z < 5 and rnd.random() < 0.5:
            streak(st_warm, (x, y - 1, 0), size * 1.2, size * (10 + rnd.random() * 14))


def build_islet():
    """基隆嶼:右側海上一塊深色剪影。"""
    nz = Noise1D(77)
    bm = bmesh.new()
    y = 2700
    x0, x1 = 760, 960
    N = 70
    top, bot = [], []
    for i in range(N + 1):
        t = i / N
        x = x0 + (x1 - x0) * t
        h = 62 * (math.sin(t * math.pi) ** 0.8) * (0.8 + 0.4 * nz.fbm(t * 6.0)) + 0.2
        h = h * (0.65 if t > 0.62 else 1.0) + (h * 0.3 if t < 0.62 else 0)
        top.append(bm.verts.new((x, y, h)))
        bot.append(bm.verts.new((x, y, -1.0)))
    for i in range(N):
        bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    DATA['islet'] = {'y': y, 'x0': x0, 'x1': x1, 'heights': [round(v.co.z, 1) for v in top]}
    me = bpy.data.meshes.new('islet')
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('islet', me))
    ob.data.materials.append(emission_mat('islet', (0.012, 0.018, 0.04), 1.0))


# ---------- 谷地暖霧(體積)----------
def build_fog():
    specs = [
        # 中心 x, y, 寬, 深, 高, 強度
        (650, 1250, 900, 800, 55, 1.0),
        (900, 2050, 1200, 600, 45, 0.9),
        (420, 1050, 460, 260, 34, 0.8),
    ]
    for i, (cx, cy, w, d, h, k) in enumerate(specs):
        DATA['fog'].append([cx, cy, w, d, h, k])
        me = bpy.data.meshes.new(f'fog{i}')
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= w
            v.co.y *= d
            v.co.z = (v.co.z + 0.5) * h
        bm.to_mesh(me)
        bm.free()
        ob = link(bpy.data.objects.new(f'fog{i}', me))
        ob.location = (cx, cy, 0)
        m = bpy.data.materials.new(f'fog{i}')
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (0.012, 0.012, 0.03)
        mp.inputs['Location'].default_value = (i * 13.0, i * 7.0, 0)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1.6
        n.inputs['Detail'].default_value = 5
        n.inputs['Roughness'].default_value = 0.62
        nt.links.new(mp.outputs[0], n.inputs['Vector'])
        # 高度衰減:貼地最濃、往上淡出;邊緣也淡出
        sepz = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Generated'], sepz.inputs[0])
        fz = nt.nodes.new('ShaderNodeMath')
        fz.operation = 'SUBTRACT'
        fz.inputs[0].default_value = 1.0
        nt.links.new(sepz.outputs['Z'], fz.inputs[1])
        fz2 = nt.nodes.new('ShaderNodeMath')
        fz2.operation = 'POWER'
        fz2.inputs[1].default_value = 1.6
        nt.links.new(fz.outputs[0], fz2.inputs[0])
        edge = nt.nodes.new('ShaderNodeMath')
        edge.operation = 'MULTIPLY'
        # 邊緣:Generated x,y 到中心距離
        sepxy = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Generated'], sepxy.inputs[0])
        ex = nt.nodes.new('ShaderNodeMath'); ex.operation = 'SUBTRACT'; ex.inputs[1].default_value = 0.5
        nt.links.new(sepxy.outputs['X'], ex.inputs[0])
        ey = nt.nodes.new('ShaderNodeMath'); ey.operation = 'SUBTRACT'; ey.inputs[1].default_value = 0.5
        nt.links.new(sepxy.outputs['Y'], ey.inputs[0])
        ex2 = nt.nodes.new('ShaderNodeMath'); ex2.operation = 'MULTIPLY'
        nt.links.new(ex.outputs[0], ex2.inputs[0]); nt.links.new(ex.outputs[0], ex2.inputs[1])
        ey2 = nt.nodes.new('ShaderNodeMath'); ey2.operation = 'MULTIPLY'
        nt.links.new(ey.outputs[0], ey2.inputs[0]); nt.links.new(ey.outputs[0], ey2.inputs[1])
        rr = nt.nodes.new('ShaderNodeMath'); rr.operation = 'ADD'
        nt.links.new(ex2.outputs[0], rr.inputs[0]); nt.links.new(ey2.outputs[0], rr.inputs[1])
        fall = nt.nodes.new('ShaderNodeMapRange')
        fall.inputs['From Min'].default_value = 0.0
        fall.inputs['From Max'].default_value = 0.22
        fall.inputs['To Min'].default_value = 1.0
        fall.inputs['To Max'].default_value = 0.0
        fall.clamp = True
        nt.links.new(rr.outputs[0], fall.inputs['Value'])
        # 雜訊分布:取亮部
        nr = nt.nodes.new('ShaderNodeMapRange')
        nr.inputs['From Min'].default_value = 0.42
        nr.inputs['From Max'].default_value = 0.72
        nr.clamp = True
        nt.links.new(n.outputs['Fac'], nr.inputs['Value'])
        d1 = nt.nodes.new('ShaderNodeMath'); d1.operation = 'MULTIPLY'
        nt.links.new(nr.outputs['Result'], d1.inputs[0]); nt.links.new(fz2.outputs[0], d1.inputs[1])
        d2 = nt.nodes.new('ShaderNodeMath'); d2.operation = 'MULTIPLY'
        nt.links.new(d1.outputs[0], d2.inputs[0]); nt.links.new(fall.outputs['Result'], d2.inputs[1])
        pv = nt.nodes.new('ShaderNodeVolumePrincipled')
        pv.inputs['Color'].default_value = (0.75, 0.7, 0.85, 1)
        dn = nt.nodes.new('ShaderNodeMath'); dn.operation = 'MULTIPLY'; dn.inputs[1].default_value = 0.02 * k
        nt.links.new(d2.outputs[0], dn.inputs[0])
        nt.links.new(dn.outputs[0], pv.inputs['Density'])
        pv.inputs['Emission Color'].default_value = (1.0, 0.5, 0.28, 1)
        es = nt.nodes.new('ShaderNodeMath'); es.operation = 'MULTIPLY'; es.inputs[1].default_value = 0.012 * k
        nt.links.new(d2.outputs[0], es.inputs[0])
        nt.links.new(es.outputs[0], pv.inputs['Emission Strength'])
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(pv.outputs[0], o.inputs['Volume'])
        ob.data.materials.append(m)
    try:
        ev = sc.eevee
        ev.volumetric_end = 9000
        ev.volumetric_tile_size = '2'
        ev.volumetric_samples = 96
    except Exception as e:
        print('volumetric 設定略過:', e)


# ---------- 近景暗色山坡(左下、右下的前景,框住畫面)----------
def ground_height(x, y):
    """近景山坡:左側是山城(高),往右、往遠處降到海面。"""
    t = (x + 40.0) / 300.0
    t = min(max(t, 0.0), 1.0)
    land = 1 - t * t * (3 - 2 * t)
    nzg = GROUND_NOISE.fbm(x * 0.012 + 5, 3) * 14 + GROUND_NOISE.fbm(y * 0.02 + 40, 3) * 8
    return land * (34 - 0.052 * (y - 130) + nzg - 11) - 6 * (1 - land) - 4


GROUND_NOISE = Noise1D(41)


def build_foreground():
    bm = bmesh.new()
    nx, ny = 90, 60
    xs = [-900 + 1300 * i / nx for i in range(nx + 1)]
    ys = [40 + 780 * j / ny for j in range(ny + 1)]
    vs = [[bm.verts.new((x, y, ground_height(x, y))) for x in xs] for y in ys]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    DATA['ground'] = {'nx': nx, 'ny': ny, 'x0': -900, 'x1': 400, 'y0': 40, 'y1': 820, 'heights': [[round(v.co.z, 1) for v in row] for row in vs]}
    me = bpy.data.meshes.new('ground')
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('ground', me))
    ob.data.materials.append(emission_mat('ground', (0.004, 0.006, 0.014), 1.0))


def build_camera():
    cd = bpy.data.cameras.new('cam')
    cd.lens = 32
    cd.clip_start = 1.0
    cd.clip_end = 60000.0  # 預設 1000 m 會把遠景整個裁掉
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = (0, 0, EYE_Z)
    cam.rotation_euler = (math.radians(88.2), 0, 0)  # 略往下;Blender 相機 X 轉 90° = 水平朝 +Y
    sc.camera = cam
    return cam


def build_compositor():
    """輝光(bloom):合成器的 Glare 節點。不同版本 API 不同,失敗就略過(光暈已用精靈做出基本效果)。"""
    try:
        if hasattr(sc, 'compositing_node_group'):
            ng = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
            sc.compositing_node_group = ng
            nodes = ng.nodes
        else:
            sc.use_nodes = True
            nodes = sc.node_tree.nodes
            nodes.clear()
            ng = sc.node_tree
        rl = nodes.new('CompositorNodeRLayers')
        gl = nodes.new('CompositorNodeGlare')
        def setin(name, val):
            try:
                gl.inputs[name].default_value = val
            except Exception as e:
                print('glare 輸入略過', name, e)
        setin('Type', 'Bloom')
        setin('Threshold', 0.9)
        setin('Size', 0.55)
        setin('Strength', 0.9)
        setin('Quality', 'High')
        if hasattr(ng, 'interface'):
            ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
            out = nodes.new('NodeGroupOutput')
            ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
            ng.links.new(gl.outputs['Image'], out.inputs[0])
        else:
            comp = nodes.new('CompositorNodeComposite')
            ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
            ng.links.new(gl.outputs['Image'], comp.inputs['Image'])
        print('Glare 已啟用')
    except Exception as e:
        print('合成器 Glare 略過:', repr(e))


build_sky()
specs = build_ridges()
build_islet()
build_sea()
if WITH_GROUND:
    build_foreground()
build_fog()
build_lights(specs)
build_camera()
build_compositor()

import json
DATA['eyeZ'] = EYE_Z
with open(OUT.rsplit('.', 1)[0] + '.json', 'w') as f:
    json.dump(DATA, f, separators=(',', ':'))
print('資料:', OUT.rsplit('.', 1)[0] + '.json', len(DATA['lights']), '光點')
if '--data-only' not in ARGS:
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print('輸出:', OUT)
