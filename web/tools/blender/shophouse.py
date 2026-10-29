"""shophouse.py——台灣老街兩層店屋加頂樓加蓋(依實體迷你模型照片,按真實建築尺寸建)。
特徵:方正長盒子;側面(+x)是灰色水泥粉刷大牆;正面二樓橄欖灰綠牆、5 扇木框窗與凸出壁柱、白色招牌燈箱、
左側外凸紅色直式招牌;一樓藍色鐵捲門 + 黃木小門 + 白色波浪鐵捲門,上方藍灰雨遮;
屋頂女兒牆、右後方藍色波浪鐵皮加蓋小屋、左前方紅色遮陽棚與木棚架。

執行(無頭):
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/shophouse.py -- tools/blender/out/shophouse.glb [--render]
座標:公尺;原點在腳底中心;正面朝 +z(three 座標);見 kit.py。
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit as K

W, D = 5.8, 10.6          # 正面寬(x)、進深(z)
FZ, BZ = D / 2, -D / 2    # 正面、背面的 z
HX = W / 2                # 半寬
BASE = 0.06               # 底座板厚(建築從這裡起)
YB = 3.45                 # 一樓頂(橫帶下緣)
YF = 3.72                 # 橫帶上緣 = 二樓起點
YR = 6.9                  # 屋頂板(二樓頂)
PAR = 0.6                 # 女兒牆高

K.reset_scene()
k = K.Kit('shophouse')
# ---- 材質(顏色取自參考照片)----
k.material('plaster', '#a3a5a0', 0.95)     # 灰色水泥粉刷
k.material('olive', '#7d8568', 0.9)        # 二樓橄欖灰綠牆
k.material('pilaster', '#979d86', 0.9)     # 壁柱(稍亮)
k.material('wood', '#c49a5a', 0.7)         # 窗框、黃木門框
k.material('glass', '#4a5652', 0.35)       # 窗玻璃(深)
k.material('white', '#ecece6', 0.6)        # 招牌燈箱
k.material('teal', '#4b8c84', 0.6)         # 招牌字(色塊)
k.material('red', '#b02a2c', 0.55)         # 紅招牌、紅遮陽棚
k.material('blue', '#4f7ca3', 0.5, metal=0.2)   # 藍色鐵捲門
k.material('silver', '#dcdddb', 0.4, metal=0.4)  # 白/銀色波浪鐵捲門
k.material('awning', '#5f7689', 0.6)       # 雨遮(藍灰)
k.material('hut', '#3f6ea0', 0.5, metal=0.2)     # 加蓋小屋藍鐵皮
k.material('base', '#2d2e30', 0.9)         # 底座板
k.material('slab', '#6b6d6b', 0.9)         # 屋頂板


def wave(key, cx, y0, y1, z0, w, vertical=True, period=0.12, amp=0.03, thick=0.012, x0=None, x1=None):
    """波浪鐵皮(封閉薄片):正弦截面。vertical=True:波浪沿 x、沿 y 擠出(牆用),寬 w、y0..y1;
    vertical=False:波浪沿 y(y0..y1)、沿 x 擠出(鐵捲門橫紋),x 範圍 cx±w/2。z0 = 外表面谷線的 z(往外凸 amp)。"""
    span = (w if vertical else (y1 - y0))
    n = max(8, int(span / period * 6))
    prof = []
    for i in range(n + 1):
        u = span * i / n
        prof.append((u, amp * 0.5 * (1 + math.sin(2 * math.pi * u / period - math.pi / 2))))
    loop = [(u, d) for u, d in prof] + [(u, d - thick) for u, d in reversed(prof)]
    m = len(loop)
    verts = []
    for u, d in loop:
        if vertical:
            xa = cx - w / 2 + u
            verts += [(xa, y0, z0 + d), (xa, y1, z0 + d)]
        else:
            ya = y0 + u
            verts += [(cx - w / 2, ya, z0 + d), (cx + w / 2, ya, z0 + d)]
    faces = []
    for i in range(m):
        j = (i + 1) % m
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    faces.append(tuple(2 * i for i in range(m - 1, -1, -1)))
    faces.append(tuple(2 * i + 1 for i in range(m)))
    k._add(key, verts, faces)


def window(w, h, cols=2, rows=4, ft=0.06, dp=0.07):
    """木框窗(局部座標:牆面上中心 (0,0)、朝 +z):深色玻璃 + 外框 + 豎/橫窗格 + 窗台。"""
    k.cuboid('glass', (0, 0, 0.01), (w, h, 0.02))
    for sx in (-1, 1):
        k.cuboid('wood', (sx * (w / 2 - ft / 2), 0, dp / 2), (ft, h, dp))
    for sy in (-1, 1):
        k.cuboid('wood', (0, sy * (h / 2 - ft / 2), dp / 2), (w, ft, dp))
    for i in range(1, cols):
        k.cuboid('wood', (-w / 2 + w * i / cols, 0, dp * 0.4), (ft * 0.6, h, dp * 0.8))
    for j in range(1, rows):
        k.cuboid('wood', (0, -h / 2 + h * j / rows, dp * 0.35), (w, ft * 0.5, dp * 0.7))
    k.cuboid('wood', (0, -h / 2 - 0.025, (dp + 0.08) / 2), (w + 0.14, 0.05, dp + 0.08))


# ===================== 底座與主體 =====================
k.cuboid('base', (0.0, BASE / 2, 0.0), (W + 0.5, BASE, D + 0.5))
k.cuboid('plaster', (0, (BASE + YR) / 2, 0), (W, YR - BASE, D))   # 整個方正量體(灰水泥)
k.cuboid('slab', (0, YR + 0.01, 0), (W - 0.1, 0.04, D - 0.1))      # 屋頂板(女兒牆內側地面)
# 一、二樓間橫帶(凸出一點)
k.cuboid('plaster', (0, (YB + YF) / 2, 0), (W + 0.1, YF - YB, D + 0.1))
# 二樓正面橄欖綠牆面
k.cuboid('olive', (0, (YF + YR) / 2, FZ + 0.015), (W, YR - YF, 0.03))
# 側面水泥牆的一條腳線,讓大牆不至於全平
for sx in (-1, 1):
    k.cuboid('plaster', (sx * (HX + 0.015), 0.35, 0), (0.03, 0.5, D))

# ===================== 女兒牆 =====================
pt = 0.2
k.cuboid('olive', (0, YR + PAR / 2, FZ - pt / 2), (W, PAR, pt))
k.cuboid('plaster', (0, YR + PAR / 2, BZ + pt / 2), (W, PAR, pt))
for sx in (-1, 1):
    k.cuboid('plaster', (sx * (HX - pt / 2), YR + PAR / 2, 0), (pt, PAR, D - 2 * pt))
# 壓頂
k.cuboid('plaster', (0, YR + PAR + 0.03, FZ - pt / 2), (W + 0.08, 0.06, pt + 0.08))
k.cuboid('plaster', (0, YR + PAR + 0.03, BZ + pt / 2), (W + 0.08, 0.06, pt + 0.08))
for sx in (-1, 1):
    k.cuboid('plaster', (sx * (HX - pt / 2), YR + PAR + 0.03, 0), (pt + 0.08, 0.06, D - 2 * pt))

# ===================== 二樓正面:壁柱、窗、招牌 =====================
PIL, PIL_P = 0.2, 0.14
pitch = (W - PIL) / 5
pil_x = [-HX + PIL / 2 + i * pitch for i in range(6)]
for x in pil_x:
    k.cuboid('pilaster', (x, (YF + 6.0) / 2, FZ + PIL_P / 2 + 0.02), (PIL, 6.0 - YF, PIL_P))
    k.cuboid('pilaster', (x, YF + 0.05, FZ + PIL_P / 2 + 0.03), (PIL + 0.06, 0.1, PIL_P + 0.02))  # 柱腳
for i in range(5):
    cx = (pil_x[i] + pil_x[i + 1]) / 2
    with k.at((cx, 4.95, FZ + 0.03)):
        window(0.68, 1.75, 2, 4)
    # 窗上方小橫楣
    k.cuboid('pilaster', (cx, 5.98, FZ + 0.05), (pitch - PIL, 0.06, 0.06))

# 白色招牌燈箱(橫向,有厚度),蓋住右側四個開間
SX0, SX1 = pil_x[1] - 0.05, HX + 0.02
SCX, SW = (SX0 + SX1) / 2, SX1 - SX0
SY, SH, SD = 6.4, 0.85, 0.34
SZ = FZ + SD / 2 + 0.02
k.cuboid('white', (SCX, SY, SZ), (SW, SH, SD))
k.cuboid('silver', (SCX, SY + SH / 2 + 0.025, SZ), (SW + 0.06, 0.05, SD + 0.04))   # 上下框
k.cuboid('silver', (SCX, SY - SH / 2 - 0.025, SZ), (SW + 0.06, 0.05, SD + 0.04))
zt = SZ + SD / 2 + 0.006
for i in range(7):       # 大字色塊
    k.cuboid('teal', (SCX - 1.2 + i * 0.36, SY + 0.1, zt), (0.28, 0.3, 0.012))
for i in range(11):      # 小字列
    k.cuboid('teal', (SCX - 1.0 + i * 0.2, SY - 0.22, zt), (0.13, 0.1, 0.012))
k.cuboid('teal', (SCX - 1.55, SY - 0.17, zt), (0.15, 0.15, 0.012))

# 左側外凸紅色直式招牌(正面朝 +z)+ 支架
RX, RY, RZ = -HX - 0.55, 5.2, FZ + 0.12
k.cuboid('red', (RX, RY, RZ), (0.85, 2.7, 0.16))
k.cuboid('plaster', (RX, RY + 1.35 + 0.03, RZ), (0.91, 0.06, 0.2))
k.cuboid('plaster', (RX, RY - 1.35 - 0.03, RZ), (0.91, 0.06, 0.2))
for dy in (-1, 1):
    k.beam('base', (-HX, RY + dy * 1.0, RZ - 0.02), (RX + 0.3, RY + dy * 1.0, RZ - 0.02), 0.05, 0.05)
for i in range(4):
    k.cuboid('white', (RX, RY + 0.85 - i * 0.55, RZ + 0.085), (0.42, 0.38, 0.012))
k.cuboid('white', (RX, RY - 1.2, RZ + 0.085), (0.3, 0.08, 0.012))

# ===================== 一樓正面 =====================
# 左:藍色鐵捲門(橫條紋)
BXc, BW, DH = -1.5, 2.3, 2.8
YD0 = BASE
k.cuboid('base', (BXc, YD0 + DH / 2, FZ + 0.03), (BW + 0.12, DH, 0.06))    # 門洞深色底
wave('blue', BXc, YD0 + 0.05, YD0 + DH, FZ + 0.05, BW, vertical=False, period=0.1, amp=0.025, thick=0.012)
k.cuboid('blue', (BXc, YD0 + DH + 0.18, FZ + 0.13), (BW + 0.16, 0.36, 0.2))     # 捲門盒
k.cuboid('blue', (BXc, YD0 + DH * 0.5, FZ + 0.05), (BW, 0.04, 0.01))               # 腰線
for sx in (-1, 1):
    k.cuboid('blue', (BXc + sx * (BW / 2 + 0.05), YD0 + DH / 2, FZ + 0.08), (0.1, DH, 0.1))
k.cuboid('wood', (BXc + 0.8, YD0 + 0.9, FZ + 0.1), (0.1, 0.06, 0.04))   # 把手

# 中:黃木小門(框 + 玻璃分格 + 下方門板)
DXc, DW = 0.15, 1.35
YDH = 2.5
k.cuboid('base', (DXc, YD0 + YDH / 2, FZ + 0.03), (DW, YDH, 0.06))
with k.at((DXc, YD0 + YDH / 2, FZ + 0.04)):
    fw = 0.1
    k.cuboid('wood', (-(DW / 2 - fw / 2), 0, 0.05), (fw, YDH, 0.1))
    k.cuboid('wood', ((DW / 2 - fw / 2), 0, 0.05), (fw, YDH, 0.1))
    k.cuboid('wood', (0, YDH / 2 - fw / 2, 0.05), (DW, fw, 0.1))
    k.cuboid('wood', (0, 0.1, 0.04), (0.05, YDH - 0.5, 0.06))       # 中梃
    k.cuboid('wood', (0, 0.35, 0.04), (DW - 0.1, 0.05, 0.06))
    k.cuboid('wood', (0, 0.8, 0.04), (DW - 0.1, 0.05, 0.06))
    k.cuboid('glass', (0, 0.55, 0.01), (DW - 0.2, 1.4, 0.02))
    k.cuboid('wood', (0, -YDH / 2 + 0.45, 0.05), (DW - 0.1, 0.9, 0.08))  # 下方木板
    k.cuboid('wood', (0, -YDH / 2 + 0.04, 0.07), (DW + 0.1, 0.08, 0.14))  # 門檻
k.cuboid('wood', (DXc, YD0 + YDH + 0.15, FZ + 0.05), (DW, 0.3, 0.1))      # 門楣

# 右:白/銀波浪鐵捲門
SXc, SWd = 1.95, 1.4
k.cuboid('base', (SXc, YD0 + DH / 2, FZ + 0.03), (SWd + 0.1, DH, 0.06))
wave('silver', SXc, YD0 + 0.05, YD0 + DH, FZ + 0.05, SWd, vertical=False, period=0.1, amp=0.025, thick=0.012)
k.cuboid('silver', (SXc, YD0 + DH + 0.18, FZ + 0.13), (SWd + 0.14, 0.36, 0.2))
for sx in (-1, 1):
    k.cuboid('silver', (SXc + sx * (SWd / 2 + 0.05), YD0 + DH / 2, FZ + 0.08), (0.08, DH, 0.1))

# 一樓上方雨遮(斜面,有厚度 + 前緣)
AW, AL, AROT = W + 0.3, 1.1, 0.26
with k.at((0, YB - 0.02, FZ + 0.03), rot_x=AROT):
    k.cuboid('awning', (0, 0, AL / 2), (AW, 0.07, AL))
    k.cuboid('awning', (0, -0.06, AL), (AW, 0.16, 0.05))        # 前緣
    for sx in (-1, 1):
        k.cuboid('awning', (sx * (AW / 2 - 0.02), -0.04, AL / 2), (0.04, 0.1, AL))  # 側緣
    for x in (-2.4, -0.9, 0.9, 2.4):                              # 肋條
        k.cuboid('awning', (x, 0.045, AL / 2), (0.04, 0.03, AL))
for x in (-2.5, 0.0, 2.5):  # 下方斜撐
    k.beam('base', (x, YB - 0.05, FZ + 0.9), (x, YB - 0.65, FZ + 0.04), 0.04, 0.04)

# ===================== 屋頂:藍色鐵皮加蓋小屋(右後方)=====================
HX0, HX1 = -0.3, HX - pt - 0.05
HZ0, HZ1 = BZ + pt + 0.2, 0.2
HH = 2.45
HCX, HCZ = (HX0 + HX1) / 2, (HZ0 + HZ1) / 2
HW, HD = HX1 - HX0, HZ1 - HZ0
k.cuboid('hut', (HCX, YR + HH / 2, HCZ), (HW - 0.04, HH, HD - 0.04))     # 內芯
k.cuboid('hut', (HCX, YR + 0.12, HCZ), (HW + 0.1, 0.24, HD + 0.1))        # 底圈
# 四面波浪鐵皮(波浪沿水平、豎向擠出)
wave('hut', HCX, YR + 0.2, YR + HH, HZ1 - 0.012 + 0.02, HW, True, 0.13, 0.035)      # +z 面
with k.at((0, 0, 0), math.pi):
    wave('hut', -HCX, YR + 0.2, YR + HH, -HZ0 + 0.01, HW, True, 0.13, 0.035)          # -z 面
with k.at((0, 0, 0), math.pi / 2):
    wave('hut', -HCZ, YR + 0.2, YR + HH, HX1 + 0.01 - 0.0, HD, True, 0.13, 0.035)    # +x 面
with k.at((0, 0, 0), -math.pi / 2):
    wave('hut', HCZ, YR + 0.2, YR + HH, -HX0 + 0.01, HD, True, 0.13, 0.035)          # -x 面
# 屋頂(微斜,波浪肋條)+ 邊框
with k.at((HCX, YR + HH + 0.06, HCZ), rot_x=0.04):
    k.cuboid('hut', (0, 0, 0), (HW + 0.3, 0.1, HD + 0.3))
    for i in range(int((HW + 0.3) / 0.14)):
        k.cuboid('hut', (-(HW + 0.3) / 2 + 0.07 + i * 0.14, 0.065, 0), (0.07, 0.03, HD + 0.3))
    k.cuboid('silver', (0, -0.04, (HD + 0.3) / 2), (HW + 0.3, 0.1, 0.03))
# 窗:+x 側面兩扇、+z 面一扇 + 一個小門框
with k.at((HX1 + 0.05, YR + 1.45, HCZ), math.pi / 2):
    for dz in (-1.3, -0.1, 1.1):
        with k.at((dz, 0, 0)):
            window(0.5, 0.8, 2, 3)
with k.at((HX0 + 0.75, YR + 1.45, HZ1 + 0.06)):
    window(0.5, 0.8, 2, 3)
with k.at((HX0 + 1.85, YR + 1.0, HZ1 + 0.06)):  # 小木門
    k.cuboid('wood', (0, 0, 0.02), (0.75, 1.7, 0.04))
    k.cuboid('glass', (0, 0.25, 0.045), (0.5, 0.8, 0.01))

# ===================== 屋頂:紅色遮陽棚(左前方)+ 木棚架 =====================
CX0, CX1 = -HX + 0.35, -0.45
CZ0, CZ1 = FZ - pt - 3.3, FZ - pt - 0.15
CRISE = 0.2
yf, yb = YR + 1.95, YR + 2.45     # 前/後柱頂
for x in (CX0, CX1):
    k.beam('wood', (x, YR, CZ1), (x, yf, CZ1), 0.08, 0.08)
    k.beam('wood', (x, YR, CZ0), (x, yb, CZ0), 0.08, 0.08)
ang = math.atan2(yb - yf, CZ1 - CZ0)
ln = math.hypot(CZ1 - CZ0, yb - yf)
with k.at(((CX0 + CX1) / 2, (yf + yb) / 2 + 0.07, (CZ0 + CZ1) / 2), rot_x=ang):
    k.cuboid('red', (0, 0, 0), (CX1 - CX0 + 0.5, 0.04, ln + 0.3))
    k.cuboid('red', (0, -0.04, ln / 2 + 0.15), (CX1 - CX0 + 0.5, 0.1, 0.03))   # 前緣垂邊
# 棚架:沿 z 的主樑 + 橫向木樑(往右延伸到加蓋小屋)
for x in (CX0, (CX0 + CX1) / 2, CX1):
    k.beam('wood', (x, yb + 0.14, CZ1 + 0.1), (x, yb + 0.14, CZ0 - 0.1), 0.09, 0.09)
for z in (CZ0 + 0.05, CZ1 - 0.05):
    k.beam('wood', (CX0 - 0.3, yb + 0.24, z), (HX0 + 0.6, yb + 0.24, z), 0.07, 0.07)
k.beam('wood', (CX1, yb + 0.1, CZ0), (HX0 + 0.6, yb + 0.1, CZ0), 0.1, 0.1)
# 側牆後角落水管
k.cylinder('awning', (HX + 0.05, (BASE + YR + PAR) / 2, BZ + 0.5), 0.045, YR + PAR - BASE, 8)

# ===================== 收尾:驗證與匯出 =====================
info = k.finalize()
info['model'] = 'shophouse'
out = (K.cli_args() or ['tools/blender/out/shophouse.glb'])[0]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

sx, sy, sz = info['size']
checks = {
    '高度約 9~10 m': 9.0 <= sy <= 10.2,
    '腳底在 y=0(±0.02)': abs(info['bbox_min'][1]) < 0.02,
    '寬度 6~7.6 m(含紅招牌、底座)': 6.0 <= sx <= 7.6,
    '深度 11~13 m(含雨遮)': 11.0 <= sz <= 13.0,
    '原點在腳底中心(x、z 偏離 < 0.7)': abs((info['bbox_min'][0] + info['bbox_max'][0]) / 2) < 0.7
    and abs((info['bbox_min'][2] + info['bbox_max'][2]) / 2) < 0.7,
    '面數 < 40000': info['tris'] < 40000,
    '材質數 ≤ 16': info['materials'] <= 16,
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
    K.render_views(prefix, [('iso', 40, 14), ('front', 0, 6), ('side', 90, 6), ('top', 35, 55)], size=(800, 640), center=(0, 4.6, 0), dist=26)
    print('RENDERED ' + prefix)
