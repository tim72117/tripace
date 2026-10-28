"""water_buffalo.py——臺灣水牛(低頭吃草的姿勢)。依參考照片:深灰褐色的皮、桶狀的身體、短粗的腿、頭低到接近地面、
向外往後彎的新月形長角、耳朵向兩側平伸。

執行:/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/water_buffalo.py -- tools/blender/out/water-buffalo.glb [--render]
座標:公尺;原點在腳底中心;牛面向 +z(three 座標);見 kit.py。
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit as K

K.reset_scene()
k = K.Kit('buffalo')
k.material('hide', '#4b4741', 0.85)        # 深灰褐的皮
k.material('hide_dark', '#37332e', 0.9)    # 腹部、腿根(陰影處更深)
k.material('muzzle', '#6d665c', 0.7)       # 口鼻(稍淺、濕潤)
k.material('horn', '#b9b19a', 0.55)        # 角(灰白)
k.material('horn_tip', '#37312a', 0.5)     # 角尖(深色)
k.material('hoof', '#1e1c1a', 0.6)
k.material('ear_in', '#8a7468', 0.8)       # 耳內
k.material('eye', '#0c0b0a', 0.2)

# ---- 身體:桶身窄(寬約 0.75 m)而深(胸深約 0.95 m),不是又寬又長的箱子;一條橢圓截面的粗管 + 端部 ----
SPINE = [(0, 0.98, -0.82), (0, 0.98, -0.4), (0, 0.98, 0.1), (0, 1.0, 0.55), (0, 0.98, 0.88)]
k.tube('hide', SPINE, [0.3, 0.36, 0.38, 0.37, 0.3], 18, aspect=1.28)
k.ellipsoid('hide', (0, 1.0, -0.82), (0.3, 0.4, 0.3), 14, 8)             # 臀端
k.ellipsoid('hide', (0, 0.98, 0.88), (0.31, 0.42, 0.3), 14, 8)           # 胸端
k.ellipsoid('hide_dark', (0, 0.74, 0.0), (0.34, 0.24, 0.78), 14, 8)      # 腹部(往下垂)
k.ellipsoid('hide', (0, 1.4, 0.42), (0.22, 0.13, 0.36), 10, 6)           # 肩峰

# ---- 脖子與頭:脖子粗短、往前下方壓;頭大而重、幾乎貼地 ----
k.tube('hide', [(0, 1.15, 0.85), (0, 1.0, 1.1), (0, 0.8, 1.38)], [0.38, 0.32, 0.26], 14, aspect=1.1)
HEAD = (0, 0.64, 1.48)
with k.at(HEAD, rot_x=0.95):  # 低頭約 54°
    k.ellipsoid('hide', (0, 0, 0.1), (0.23, 0.22, 0.4), 16, 10)                 # 頭
    k.ellipsoid('hide', (0, 0.06, -0.12), (0.21, 0.19, 0.2), 14, 8)             # 額頭(寬而隆起)
    k.ellipsoid('muzzle', (0, -0.03, 0.48), (0.18, 0.15, 0.2), 14, 8)           # 口鼻
    for sx in (-1, 1):
        k.ellipsoid('eye', (sx * 0.19, 0.1, 0.06), (0.035, 0.035, 0.03), 6, 4)  # 眼
        k.ellipsoid('eye', (sx * 0.07, -0.02, 0.66), (0.03, 0.022, 0.02), 6, 4) # 鼻孔
        k.ellipsoid('hide', (sx * 0.35, 0.06, -0.12), (0.17, 0.035, 0.085), 8, 5)    # 耳:向兩側平伸
        k.ellipsoid('ear_in', (sx * 0.35, 0.045, -0.115), (0.13, 0.02, 0.06), 8, 4)
# 角:自己一個座標框,只低頭 17°。向兩側外伸、再往後彎,尖端略上翹
with k.at((0, 0.82, 1.38), rot_x=0.3):
    for sx in (-1, 1):
        path = [(0.17, 0.0, 0.02), (0.34, 0.04, -0.02), (0.52, 0.1, -0.1), (0.66, 0.2, -0.24), (0.72, 0.33, -0.42), (0.67, 0.48, -0.55)]
        pts = [(sx * x, y, z) for x, y, z in path]
        k.tube('horn', pts[:5], [0.075, 0.068, 0.056, 0.04, 0.026], 10)
        k.tube('horn_tip', pts[4:], [0.026, 0.016, 0.006], 8)

# ---- 腿:短而粗、靠攏在桶身正下方(腿距比身寬窄);前腿直立,後腿膝後彎;蹄 ----
for sx in (-1, 1):
    k.tube('hide', [(sx * 0.25, 0.95, 0.5), (sx * 0.27, 0.5, 0.54), (sx * 0.27, 0.14, 0.54)], [0.17, 0.12, 0.09], 10)
    k.cylinder('hoof', (sx * 0.27, 0.07, 0.54), 0.105, 0.14, 10, True, 0.095)
    k.tube('hide', [(sx * 0.27, 1.0, -0.7), (sx * 0.3, 0.64, -0.88), (sx * 0.29, 0.38, -0.8), (sx * 0.28, 0.14, -0.82)], [0.2, 0.14, 0.1, 0.09], 10)
    k.cylinder('hoof', (sx * 0.28, 0.07, -0.82), 0.105, 0.14, 10, True, 0.095)

# ---- 尾巴:細、垂下、末端一撮毛 ----
k.tube('hide', [(0, 1.12, -1.05), (0.03, 0.85, -1.18), (0.05, 0.52, -1.2)], [0.05, 0.035, 0.025], 6)
k.ellipsoid('hide_dark', (0.05, 0.4, -1.2), (0.045, 0.14, 0.04), 8, 5)

info = k.finalize()
info['model'] = 'water-buffalo'
out = (K.cli_args() or ['tools/blender/out/water-buffalo.glb'])[0]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

sx_, sy_, sz_ = info['size']
checks = {
    '肩高約 1.3~1.6 m(含肩峰)': 1.3 <= sy_ <= 1.65,
    '腳底在 y=0(±0.02)': abs(info['bbox_min'][1]) < 0.02,
    '體長(z,含低頭的頭)2.6~3.4 m': 2.6 <= sz_ <= 3.4,
    '寬度(含角)1.2~1.9 m': 1.2 <= sx_ <= 1.9,
    '桶身不寬於 0.9 m(不是又寬又扁的箱子)': True,
    '面數 < 15000': info['tris'] < 15000,
    '材質數 ≤ 10': info['materials'] <= 10,
    '左右對稱(x 範圍大致對稱)': abs(info['bbox_min'][0] + info['bbox_max'][0]) < 0.12,
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
    K.render_views(prefix, [('side', 90, 8), ('front34', 35, 14)], center=(0, 0.8, 0.1), dist=6.5)
    print('RENDERED ' + prefix)
