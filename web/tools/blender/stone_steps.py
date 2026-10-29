"""stone_steps.py——石階地形磚(九份豎崎路一類的石階):一次匯出多種樣式,頭尾對齊,可串接成長階梯。

執行:blender --background --python tools/blender/stone_steps.py -- tools/blender/out [--render]
  (第一個參數是輸出資料夾,每種樣式一個 stone-<名稱>.glb 與 .stats.json)
座標:公尺;three 座標(見 kit.py)。

串接規則(所有樣式共用):
  - 寬度固定 WIDTH(3 m);石階往 -z 方向「上升」(站在 +z 往上看);
  - 原點在入口邊的中心、入口地面高度(y=0);頂面離入口地面的高度 = 階數 × RISE;
  - 平台(landing)的頂面與前一段最後一階齊平,所以「下一塊的原點 = 上一塊的出口點」,
    把下一塊放在上一塊出口點、轉成出口朝向(yaw)即可無縫接上;
  - 出口點與朝向寫在 stats.json 的 exit(pos、yaw 度數),另有 dims:tread、riser、steps、width、footing、length、height、
    landing_start(尾端平台起點占總長的比例,沒有尾端平台則 1),給程式產生走路坡線、對齊地形用;
  - 模型內的空節點:Socket_bottom(入口中心)、Socket_top(出口中心)、Socket_rail_L / Socket_rail_R(入口兩側邊緣,欄杆或擋牆的起點);
  - 磚底往下延伸 BASE_DEPTH,方便埋進地面或坡面。
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit as K
from mathutils import Matrix, Vector

WIDTH = 3.0
RISE = 0.18          # 每階高
TREAD = 0.36         # 每階深
BASE_DEPTH = 0.3     # 磚底在入口地面以下多少(往下實心,埋進地面)
NOSE = 0.03          # 階緣往前探出的量

# 樣式 = 段落串列:('steps', 階數)、('landing', 深度)、('turn', 'left'|'right')(WIDTH × WIDTH 的轉角平台)
VARIANTS = {
    'steps-5': [('steps', 5)],
    'steps-10': [('steps', 10)],
    'steps-landing': [('steps', 5), ('landing', 1.2), ('steps', 5)],
    'steps-to-landing': [('steps', 6), ('landing', 1.5)],
    'landing-to-steps': [('landing', 1.5), ('steps', 6)],
    'landing': [('landing', 3.0)],
    'turn-left': [('steps', 5), ('turn', 'left')],
    'turn-right': [('steps', 5), ('turn', 'right')],
}


def slabs(k, rng, z_front, depth, top, nose=True):
    """一排石板(橫跨 WIDTH,分 2~3 塊):頂面在 top,往下實心到 -BASE_DEPTH(局部座標,y 以段落起點為 0)。"""
    n = rng.choice((2, 3))
    fr = [rng.uniform(0.8, 1.25) for _ in range(n)]
    ws = [WIDTH * f / sum(fr) for f in fr]
    x = -WIDTH / 2
    bottom = k.floor_y
    for w in ws:
        t = top + rng.uniform(-0.012, 0.012)
        zf = z_front + (NOSE if nose else 0) + rng.uniform(-0.012, 0.012)
        d = depth + (NOSE if nose else 0)
        mat = rng.choices(('stone', 'stone_dark', 'stone_light'), (5, 2, 2))[0]
        k.cuboid(mat, (x + w / 2, (t + bottom) / 2, zf - d / 2), (w - 0.006, t - bottom, d))
        if rng.random() < 0.18:  # 縫裡長的青苔,小小一塊
            mw, md = rng.uniform(0.18, 0.4), rng.uniform(0.08, 0.16)
            k.cuboid('moss', (x + rng.uniform(mw / 2, w - mw / 2), t + 0.004, zf - rng.uniform(md, d - md)), (mw, 0.012, md))
        x += w


def build(name, segs):
    rng = random.Random(sum(map(ord, name)))
    K.reset_scene()
    k = K.Kit('steps_' + name.replace('-', '_'))
    k.material('stone', '#8f8a80', 0.95)
    k.material('stone_dark', '#76716a', 0.95)
    k.material('stone_light', '#a8a296', 0.92)
    k.material('moss', '#566f38', 1.0)
    k.floor_y = -BASE_DEPTH
    pos, yaw = Vector((0, 0, 0)), 0.0  # 目前段落的起點(磚座標)與朝向
    k.anchor('Socket_bottom', (0, 0, 0))
    k.anchor('Socket_rail_L', (-WIDTH / 2, 0, 0))
    k.anchor('Socket_rail_R', (WIDTH / 2, 0, 0))
    length, landing_tail = 0.0, 0.0
    steps_total = 0
    for kind, arg in segs:
        with k.at(tuple(pos), rot_y=yaw):
            k.floor_y = -BASE_DEPTH - pos.y
            if kind == 'steps':
                for i in range(arg):
                    slabs(k, rng, -i * TREAD, TREAD, (i + 1) * RISE)
                dyaw, off = 0.0, Vector((0, arg * RISE, -arg * TREAD))
                length += arg * TREAD
                landing_tail = 0.0
                steps_total += arg
            elif kind == 'landing':
                for i in range(max(1, round(arg / 0.75))):  # 平台分排,每排約 0.75 m
                    d = arg / max(1, round(arg / 0.75))
                    slabs(k, rng, -i * d, d, 0.0, nose=False)
                off, dyaw = Vector((0, 0, -arg)), 0.0
                length += arg
                landing_tail += arg
            else:  # turn:WIDTH × WIDTH 的平台,出口在左/右邊中心
                for i in range(3):
                    slabs(k, rng, -i * WIDTH / 3, WIDTH / 3, 0.0, nose=False)
                s = 1 if arg == 'left' else -1
                off, dyaw = Vector((-s * WIDTH / 2, 0, -WIDTH / 2)), s * math.pi / 2
                length += WIDTH
                landing_tail += WIDTH
        M = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Y')
        pos = M @ off
        yaw += dyaw
    k.anchor('Socket_top', tuple(pos))
    k.floor_y = -BASE_DEPTH
    dims = {'tread': TREAD, 'riser': RISE, 'steps': steps_total, 'width': WIDTH, 'footing': BASE_DEPTH, 'length': round(length, 3), 'height': round(steps_total * RISE, 3), 'landing_start': round(1 - landing_tail / length, 3)}
    return k, pos, yaw, steps_total, dims


def main():
    args = [a for a in K.cli_args() if not a.startswith('--')]
    out_dir = args[0] if args else 'tools/blender/out'
    out_dir = os.path.abspath(out_dir)  # Blender 的渲染輸出路徑不吃相對路徑
    os.makedirs(out_dir, exist_ok=True)
    only = [a for a in args[1:]]  # 可只跑指定樣式
    bad_all = []
    for name, segs in VARIANTS.items():
        if only and name not in only:
            continue
        k, pos, yaw, n, dims = build(name, segs)
        info = k.finalize()
        info['model'] = 'stone-' + name
        info['dims'] = dims
        info['exit'] = {'pos': [round(v, 3) for v in pos], 'yaw_deg': round(math.degrees(yaw)) % 360}
        sx, sy, sz = info['size']
        top = max(info['bbox_max'][1], 0)
        checks = {
            '寬度不超過 3 m(轉角磚的平台往側邊延伸,另算)': sx <= WIDTH + 0.05 or 'turn' in name,
            f'磚底在 -{BASE_DEPTH}': abs(info['bbox_min'][1] + BASE_DEPTH) < 0.02,
            '頂面高度 = 階數 × RISE(±0.03)': abs(top - n * RISE) < 0.03 if n else abs(top) < 0.03,
            '面數 < 4000': info['tris'] < 4000,
            '材質數 ≤ 4': info['materials'] <= 4,
        }
        info['checks'] = {c: bool(ok) for c, ok in checks.items()}
        print('STATS ' + json.dumps(info, ensure_ascii=False))
        bad = [c for c, ok in checks.items() if not ok]
        if bad:
            bad_all.append(name + ':' + '、'.join(bad))
            continue
        path = os.path.join(out_dir, f'stone-{name}.glb')
        K.export_glb(path)
        with open(os.path.splitext(path)[0] + '.stats.json', 'w') as f:
            json.dump(info, f, ensure_ascii=False, indent=1)
        print('EXPORTED ' + path)
        if '--render' in K.cli_args():
            c = (info['bbox_min'][0] + info['bbox_max'][0]) / 2, top / 2 + 0.3, (info['bbox_min'][2] + info['bbox_max'][2]) / 2
            K.render_views(os.path.splitext(path)[0] + '-preview', [('iso', -35, 28), ('side', 90, 10)], size=(640, 400), center=c, dist=max(6.5, sz * 1.8))
    if bad_all:
        raise SystemExit('驗證失敗:' + ';'.join(bad_all))


main()
