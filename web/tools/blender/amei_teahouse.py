"""amei_teahouse.py——阿妹茶樓(九份)。依參考照片:三層深綠漆木樓閣、琥珀色格子窗、一樓紅色門板、層層灰瓦屋簷、紅燈籠、垂掛藤蔓、二樓陽台。

執行(無頭):
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/amei_teahouse.py -- tools/blender/out/amei-teahouse.glb [--render]
座標:公尺;原點在腳底中心;正面朝 +z(three 座標);見 kit.py。
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit as K
from mathutils import Vector

W, D = 11.0, 5.6         # 一、二樓的寬(x)與深(z):照片是寬扁的長方形,屋脊才會長
W3, D3 = W - 1.2, D - 1.0  # 三樓內縮
PODIUM = 0.35
Y1, Y2, Y3, YTOP = 3.45, 6.65, 9.55, 11.35   # 一/二/三樓的頂、屋頂脊(屋面坡度放緩)

K.reset_scene()
k = K.Kit('amei')
# ---- 材質(顏色取自參考照片)----
k.material('wall', '#2c4637', 0.75)               # 深綠漆木
k.material('wood', '#4a2f22', 0.8)                # 窗櫺、橫梁(深褐木)
k.material('roof', '#3b3e44', 0.55)               # 灰瓦
k.material('ridge', '#5a5c61', 0.6)               # 瓦壟、屋脊(稍亮)
k.material('trim', '#cbbd9e', 0.7)                # 屋簷鑲邊(米色)
k.material('red', '#a02620', 0.45)                # 紅漆
k.material('black', '#16171a', 0.6)               # 門框
k.material('gold', '#c9a24a', 0.35, metal=0.7)    # 燈籠蓋、門把
k.material('glow', '#ff9a3c', 0.5, emit='#ff9a3c', emit_strength=2.4)   # 窗內暖光
k.material('lantern', '#d63a2f', 0.5, emit='#ff4a2a', emit_strength=3.0)  # 紅燈籠
k.material('leaf_a', '#4d7a38', 0.9)
k.material('leaf_b', '#6c9a45', 0.9)
k.material('stone', '#8a867e', 0.9)

rnd = random.Random(11)


def roof(y0, y1, bw, bd, tw, td, name_ribs=0.4):
    """灰瓦屋面(截頭錐)+ 瓦壟 + 底緣米色鑲邊。"""
    k.frustum('roof', y0, y1, bw, bd, tw, td)
    bl = [(-bw / 2, -bd / 2), (bw / 2, -bd / 2), (bw / 2, bd / 2), (-bw / 2, bd / 2)]
    tl = [(-tw / 2, -td / 2), (tw / 2, -td / 2), (tw / 2, td / 2), (-tw / 2, td / 2)]
    for i in range(4):
        b0, b1, t0, t1 = bl[i], bl[(i + 1) % 4], tl[i], tl[(i + 1) % 4]
        edge = Vector((b1[0] - b0[0], 0, b1[1] - b0[1]))
        slope = Vector((t0[0] - b0[0], y1 - y0, t0[1] - b0[1]))
        out = edge.cross(slope)
        out = out.normalized() if out.y > 0 else -out.normalized()
        out = -out if out.dot(Vector(((b0[0] + b1[0]) / 2, 0, (b0[1] + b1[1]) / 2))) < 0 else out
        n = max(2, int(edge.length / name_ribs))
        for j in range(n):
            t = (j + 0.5) / n
            p0 = Vector((b0[0] + (b1[0] - b0[0]) * t, y0, b0[1] + (b1[1] - b0[1]) * t)) + out * 0.025
            p1 = Vector((t0[0] + (t1[0] - t0[0]) * t, y1, t0[1] + (t1[1] - t0[1]) * t)) + out * 0.025
            k.beam('ridge', p0, p1, 0.07, 0.05)
        # 底緣鑲邊
        k.beam('trim', Vector((b0[0], y0 + 0.02, b0[1])) + out * 0.03, Vector((b1[0], y0 + 0.02, b1[1])) + out * 0.03, 0.18, 0.1,
               up=(0, 1, 0) if abs(edge.y) < 1e-6 else (1, 0, 0))


def lattice_window(w, h, cols=5, rows=4, depth=0.05):
    """格子窗:外框 + 竪櫺橫櫺 + 暖光玻璃。局部座標:中心在 (0,0),朝 +z。"""
    ft = 0.09
    k.cuboid('glow', (0, 0, -0.02), (w, h, 0.02))
    for sx in (-1, 1):
        k.cuboid('wood', (sx * (w / 2 + ft / 2), 0, depth / 2), (ft, h + ft * 2, depth + 0.04))
    for sy in (-1, 1):
        k.cuboid('wood', (0, sy * (h / 2 + ft / 2), depth / 2), (w + ft * 2, ft, depth + 0.04))
    for i in range(1, cols):
        x = -w / 2 + w * i / cols
        k.cuboid('wood', (x, 0, depth / 2), (0.035, h, depth))
    for j in range(1, rows):
        y = -h / 2 + h * j / rows
        k.cuboid('wood', (0, y, depth / 2), (w, 0.03, depth))
    k.cuboid('wood', (0, -h / 2 - ft - 0.04, 0.09), (w + 0.4, 0.07, 0.2))  # 窗台


LANTERNS_AS_ANCHORS = True  # True:燈籠不畫進模型,只放錨點(lantern_NN),由島上的程式用實例擺放(three/stopLanterns.ts);False:每盞都畫進模型


def lantern(x, y, z, r=0.24, h=0.36):
    if LANTERNS_AS_ANCHORS:
        # 島上的燈籠幾何固定是這個尺寸(r=0.24、h=0.36),所以錨點只記位置
        assert (r, h) == (0.24, 0.36), '錨點模式的燈籠尺寸固定,要改尺寸請同步 three/stopLanterns.ts'
        k.anchor(f'lantern_{len(k.anchors):02d}', (x, y, z))
        return
    k.cylinder('gold', (x, y + h / 2 + 0.03, z), 0.07, 0.06, 8, False)
    k.ellipsoid('lantern', (x, y, z), (r, h / 2, r), 12, 7)
    k.cylinder('gold', (x, y - h / 2 - 0.02, z), 0.06, 0.05, 8, False)
    k.beam('red', (x, y - h / 2 - 0.04, z), (x, y - h / 2 - 0.26, z), 0.025, 0.025)
    k.beam('wood', (x, y + h / 2 + 0.06, z), (x, y + h / 2 + 0.3, z), 0.015, 0.015)


VINE_DENSITY = 0.15  # 藤蔓數量倍率:每處呼叫的叢數乘上它(至少 1 叢;原本傳 0 的維持 0)。藤蔓是面數與檔案大小的大宗,調低就變輕


def vines(x0, x1, y, z, count, drop=(0.5, 1.4)):
    """沿一條線(x0→x1, 高 y, 前後 z)的藤蔓:一叢叢葉團 + 往下垂的藤條。"""
    if count > 0:
        count = max(1, round(count * VINE_DENSITY))
    for _ in range(count):
        x = rnd.uniform(x0, x1)
        mat = 'leaf_a' if rnd.random() < 0.55 else 'leaf_b'
        for _ in range(3):
            k.ellipsoid(mat, (x + rnd.uniform(-0.18, 0.18), y + rnd.uniform(0, 0.18), z + rnd.uniform(-0.12, 0.12)),
                        (rnd.uniform(0.1, 0.2), rnd.uniform(0.07, 0.14), rnd.uniform(0.09, 0.16)), 6, 4, False)
        for _ in range(2):
            d = rnd.uniform(*drop)
            xx = x + rnd.uniform(-0.12, 0.12)
            k.beam(mat, (xx, y, z + 0.02), (xx + rnd.uniform(-0.05, 0.05), y - d, z + 0.07), 0.045, 0.03)
            k.ellipsoid(mat, (xx, y - d, z + 0.07), (0.08, 0.1, 0.06), 6, 4, False)


# ===================== 基座與台階 =====================
k.cuboid('stone', (0, PODIUM / 2, 0), (W + 1.2, PODIUM, D + 1.2))
for i in range(3):  # 前方左側三級石階(離牆越遠越低):從基座邊緣往外
    h = 0.0875 * (i + 1)
    k.cuboid('stone', (-1.1, h / 2, D / 2 + 0.6 + 0.15 + 0.3 * (2 - i)), (2.6, h, 0.3))

# ===================== 牆身 =====================
k.cuboid('wall', (0, (PODIUM + Y1) / 2, 0), (W, Y1 - PODIUM, D))            # 一樓
k.cuboid('wall', (0, (Y1 + Y2) / 2, 0), (W, Y2 - Y1, D))                    # 二樓
k.cuboid('wall', (0, (Y2 + Y3) / 2, 0), (W3, Y3 - Y2, D3))                  # 三樓(內縮)
# 樓層間橫梁(深褐木,凸出牆面)
for y, w, d in ((Y1, W, D), (Y2, W, D), (Y3, W3, D3)):
    k.cuboid('wood', (0, y, 0), (w + 0.16, 0.22, d + 0.16))

# ===================== 立面:每個面的窗、柱 =====================
def facade(rot, width, depth_half, y_f1, y_f2, y_f3, floor_w, side='front'):
    """在 rot 方向的立面上放柱與窗;局部座標:立面中心 (0, y, depth_half) 朝外 +z。"""
    with k.at((0, 0, 0), rot):
        # 一樓:柱(正面右前角柱是紅色)、紅色門板
        n1 = 5 if side in ('front', 'back') else 3
        for i in range(n1 + 1):
            x = -width / 2 + width * i / n1
            red = side == 'front' and i == n1
            k.cuboid('red' if red else 'wood', (x, (PODIUM + Y1) / 2, depth_half + 0.04), (0.28, Y1 - PODIUM, 0.16))
        for i in range(n1):
            cx = -width / 2 + width * (i + 0.5) / n1
            bw = width / n1 - 0.4
            if side == 'front' and i == 0:  # 左側一格:深色入口凹口
                k.cuboid('black', (cx, PODIUM + 1.4, depth_half + 0.03), (bw, 2.5, 0.05))
                continue
            if side == 'front' and i == n1 - 1:  # 右側一格:小格子窗
                with k.at((cx, 2.2, depth_half + 0.03)):
                    lattice_window(bw * 0.8, 1.2, 4, 3)
                continue
            # 紅色雙扇門板 + 黑框 + 金色門把
            k.cuboid('black', (cx, PODIUM + 1.5, depth_half + 0.03), (bw + 0.1, 2.75, 0.04))
            for sx in (-1, 1):
                k.cuboid('red', (cx + sx * (bw / 4 + 0.02), PODIUM + 1.5, depth_half + 0.065), (bw / 2 - 0.05, 2.6, 0.04))
                k.ellipsoid('gold', (cx + sx * 0.08, PODIUM + 1.45, depth_half + 0.11), (0.04, 0.04, 0.03), 6, 4)
        # 二樓:格子窗 + 柱
        n2 = 5 if side in ('front', 'back') else 2
        for i in range(n2 + 1):
            x = -width / 2 + width * i / n2
            k.cuboid('wood', (x, (Y1 + Y2) / 2, depth_half + 0.04), (0.26, Y2 - Y1 - 0.2, 0.14))
        for i in range(n2):
            cx = -width / 2 + width * (i + 0.5) / n2
            with k.at((cx, (Y1 + Y2) / 2 + 0.05, depth_half + 0.03)):
                lattice_window(width / n2 - 0.75, 1.75, 5, 4)
        # 三樓
        w3 = floor_w
        n3 = 4 if side in ('front', 'back') else 2
        d3 = depth_half - 0.5
        for i in range(n3 + 1):
            x = -w3 / 2 + w3 * i / n3
            k.cuboid('wood', (x, (Y2 + Y3) / 2, d3 + 0.04), (0.26, Y3 - Y2 - 0.2, 0.14))
        for i in range(n3):
            cx = -w3 / 2 + w3 * (i + 0.5) / n3
            with k.at((cx, (Y2 + Y3) / 2 + 0.05, d3 + 0.03)):
                lattice_window(w3 / n3 - 0.75, 1.6, 5, 4)


facade(0.0, W, D / 2, 0, 0, 0, W3, 'front')
facade(math.pi, W, D / 2, 0, 0, 0, W3, 'back')
facade(math.pi / 2, D, W / 2, 0, 0, 0, D3, 'right')
facade(-math.pi / 2, D, W / 2, 0, 0, 0, D3, 'left')

# 正面右側一樓的紅色豎招牌
k.cuboid('red', (W / 2 - 2.2, 2.3, D / 2 + 0.14), (0.45, 1.7, 0.05))
k.cuboid('gold', (W / 2 - 2.2, 2.3, D / 2 + 0.17), (0.3, 1.3, 0.02))

# ===================== 屋簷(三層)=====================
roof(Y1 - 0.05, Y1 + 0.65, W + 2.4, D + 2.4, W + 0.12, D + 0.12)            # 一樓簷
roof(Y2 - 0.05, Y2 + 0.65, W + 2.2, D + 2.2, W3 + 0.12, D3 + 0.12)          # 二樓簷
roof(Y3 - 0.15, YTOP, W3 + 2.8, D3 + 2.8, W3 - D3 + 0.1, 0.14)  # 三樓大四坡頂
k.beam('ridge', (-(W3 - D3) / 2 - 0.4, YTOP + 0.05, 0), ((W3 - D3) / 2 + 0.4, YTOP + 0.05, 0), 0.22, 0.2)  # 屋脊

# ===================== 紅燈籠(簷下一排)=====================
def lantern_row(y, half_w, z, step):
    n = int(2 * half_w / step) + 1
    for i in range(n):
        lantern(-half_w + i * 2 * half_w / max(1, n - 1), y, z)

lantern_row(Y1 - 0.55, (W + 2.0) / 2, (D + 2.4) / 2 - 0.15, 1.15)            # 一樓簷下(前)
lantern_row(Y2 - 0.55, (W + 1.8) / 2, (D3 + 2.2) / 2 - 0.1 + 0.5, 1.15)      # 二樓簷下(前)
lantern_row(Y3 - 0.65, (W3 + 2.4) / 2, (D3 + 2.8) / 2 - 0.15, 1.2)           # 三樓大屋頂下(前)
for z in (-1.8, 0.2, 2.2):                                                      # 左側面(照片可見)
    lantern(-(W + 2.4) / 2 + 0.15, Y1 - 0.55, z)
    lantern(-(W3 + 2.8) / 2 + 0.15, Y3 - 0.65, z * 0.8)

# ===================== 藤蔓與陽台 =====================
vines(-(W + 1.8) / 2, (W + 1.8) / 2, Y1 + 0.05, (D + 2.4) / 2 - 0.05, 44, (0.6, 1.6))       # 一樓簷口
vines(-(W3 + 1.6) / 2, (W3 + 1.6) / 2, Y2 + 0.05, (D3 + 2.2) / 2 - 0.05, 34, (0.5, 1.4))    # 二樓簷口
vines(-(D + 1.6) / 2, (D + 1.6) / 2, Y1 + 0.05, 0, 0)

# 二樓左側陽台:木地板 + 四根落地柱 + 欄杆 + 植栽
BX0, BX1, BZ0, BZ1, BY = -W / 2 - 2.1, -W / 2, -1.4, 2.4, Y1 + 0.75
k.cuboid('wood', ((BX0 + BX1) / 2, BY - 0.07, (BZ0 + BZ1) / 2), (BX1 - BX0, 0.14, BZ1 - BZ0))
# 托住陽台的斜撐:從外牆斜向外頂住地板外緣,不落地(模型放在島上不平的地面時不會懸空或穿地)
for z in (BZ0 + 0.25, (BZ0 + BZ1) / 2, BZ1 - 0.25):
    k.beam('wood', (BX1, BY - 1.25, z), (BX0 + 0.15, BY - 0.12, z), 0.14, 0.12, up=(0, 0, 1))
    k.beam('wood', (BX0 + 0.1, BY - 0.14, z), (BX0 + 0.1, BY - 0.5, z), 0.12, 0.12)
rail_y = BY + 1.0
posts = []
n_front = 9
for i in range(n_front + 1):
    posts.append((BX0 + 0.05, BZ1 - 0.05 - (BZ1 - BZ0 - 0.1) * i / n_front))
for i in range(1, 5):
    posts.append((BX0 + 0.05 + (BX1 - BX0 - 0.1) * i / 5 * 1.0 - 0.0, BZ1 - 0.05))
for i in range(1, 5):
    posts.append((BX0 + 0.05 + (BX1 - BX0 - 0.1) * i / 5, BZ0 + 0.05))
for x, z in posts:
    k.beam('wood', (x, BY, z), (x, rail_y, z), 0.05, 0.05)
for (x0, z0, x1, z1) in ((BX0 + 0.05, BZ0 + 0.05, BX0 + 0.05, BZ1 - 0.05), (BX0 + 0.05, BZ1 - 0.05, BX1, BZ1 - 0.05), (BX0 + 0.05, BZ0 + 0.05, BX1, BZ0 + 0.05)):
    k.beam('wood', (x0, rail_y, z0), (x1, rail_y, z1), 0.09, 0.07)
    k.beam('wood', (x0, BY + 0.12, z0), (x1, BY + 0.12, z1), 0.05, 0.05)
vines(BX0 + 0.1, BX0 + 0.1, rail_y + 0.05, BZ1 - 0.05, 0)
for i in range(8):  # 欄杆上的植栽與垂藤
    z = BZ0 + 0.2 + (BZ1 - BZ0 - 0.4) * i / 7
    vines(BX0 + 0.05, BX0 + 0.05, rail_y + 0.08, z, 3, (0.5, 1.3))
for i in range(5):
    vines(BX0 + 0.3 + i * 0.4, BX0 + 0.3 + i * 0.4, rail_y + 0.08, BZ1 - 0.05, 3, (0.5, 1.2))
# 陽台上的一張小桌與圓凳
k.cylinder('wood', (BX0 + 1.0, BY + 0.38, 0.8), 0.32, 0.05, 14)
k.cylinder('wood', (BX0 + 1.0, BY + 0.18, 0.8), 0.04, 0.36, 8)
for dx, dz in ((-0.6, 0), (0.6, 0), (0, 0.6)):
    k.cylinder('wood', (BX0 + 1.0 + dx, BY + 0.24, 0.8 + dz), 0.17, 0.05, 10)

info = k.finalize()
info['model'] = 'amei-teahouse'
out = (K.cli_args() or ['tools/blender/out/amei-teahouse.glb'])[0]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

# ---- 數字驗證(尺寸、原點、面數):不合格就丟錯,不匯出壞模型 ----
sx, sy, sz = info['size']
checks = {
    '高度約 11.4 m': 11.0 <= sy <= 12.2,
    '腳底在 y=0(±0.02)': abs(info['bbox_min'][1]) < 0.02,
    '寬度 13~17 m(含陽台與屋簷)': 13 <= sx <= 17,
    '深度 7.5~10 m': 7.5 <= sz <= 10,
    '面數 < 80000': info['tris'] < 80000,
    '材質數 ≤ 16': info['materials'] <= 16,
    '燈籠錨點數量合理(錨點模式 20~60 個)': (not LANTERNS_AS_ANCHORS) or 20 <= info['anchors'] <= 60,
}
info['checks'] = {n: bool(ok) for n, ok in checks.items()}
print('STATS ' + json.dumps(info, ensure_ascii=False))
bad = [n for n, ok in checks.items() if not ok]
if bad:
    raise SystemExit('驗證失敗:' + '、'.join(bad))
K.export_glb(out)
with open(os.path.splitext(out)[0] + '.stats.json', 'w') as f:
    json.dump(info, f, ensure_ascii=False, indent=1)
print('EXPORTED ' + out)

if '--render' in K.cli_args():
    prefix = os.path.splitext(out)[0] + '-preview'
    K.render_views(prefix, [('iso-left', -38, 14), ('front', 0, 6)], center=(-0.5, 5.5, 0), dist=27)
    print('RENDERED ' + prefix)
