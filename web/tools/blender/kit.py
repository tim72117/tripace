"""kit.py——Blender 建模共用工具(在 Blender 的 Python 裡執行,不是主專案的一部分)。

座標約定:**腳本裡一律用 glTF/three 的座標**——x 右、y 上、z 前(模型正面朝 +z),單位公尺,原點在腳底中心。
結束時才一次轉成 Blender 的座標(Z 向上、前方 -Y)再匯出,匯出器會轉回 glTF,所以 three 載入後正面朝 +z。

做法:每個材質累積成一個 bmesh,最後每個材質一個物件(模型只有十來個物件,節點與繪製呼叫都少);
所有形狀都是自己用頂點和面建的(方塊、斜樑、截頭錐、圓柱、橢球),不依賴 bpy.ops,所以無頭執行穩定、結果可重現。
"""
import bpy, bmesh, math, json, sys, random
from contextlib import contextmanager
from mathutils import Matrix, Vector

TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # (x, y, z) → (x, -z, y)


def srgb(hex_color):
    h = hex_color.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


class Kit:
    def __init__(self, name):
        self.name = name
        self.mats, self.bms, self.smooth_mats = {}, {}, set()
        self.anchors = []  # [(名稱, glTF 座標位置)]:匯出成空物件(GLB 裡的無網格節點),給執行端放實例(燈籠等)
        self.stack = [Matrix.Identity(4)]

    # ---- 材質 ----
    def material(self, key, color, rough=0.8, metal=0.0, emit=None, emit_strength=0.0):
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb(color), 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if emit:
            b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
            b.inputs['Emission Strength'].default_value = emit_strength
        self.mats[key] = m
        return key

    def _bm(self, key):
        if key not in self.bms:
            assert key in self.mats, f'沒有材質 {key}'
            self.bms[key] = bmesh.new()
        return self.bms[key]

    # ---- 座標變換堆疊(glTF 座標)----
    @contextmanager
    def at(self, pos=(0, 0, 0), rot_y=0.0, rot_x=0.0):
        """局部座標:先平移,再繞 Y(轉向),再繞 X(正值 = 前方 +z 往下壓,低頭用)。"""
        self.stack.append(self.stack[-1] @ Matrix.Translation(Vector(pos)) @ Matrix.Rotation(rot_y, 4, 'Y') @ Matrix.Rotation(rot_x, 4, 'X'))
        try:
            yield
        finally:
            self.stack.pop()

    def _add(self, key, verts, faces, smooth=False):
        bm, M = self._bm(key), self.stack[-1]
        vs = [bm.verts.new(M @ Vector(v)) for v in verts]
        for f in faces:
            try:
                face = bm.faces.new([vs[i] for i in f])
                face.smooth = smooth
            except ValueError:
                pass  # 重複的面(共用頂點時偶爾發生),略過

    def anchor(self, name, pos):
        """錨點:不畫任何幾何,只在 pos(套用目前的局部座標)記一個名字;匯出成 GLB 裡的空節點,
        執行端依名稱前綴(例如 lantern_)讀位置,用實例擺放共用的小模型。"""
        self.anchors.append((name, self.stack[-1] @ Vector(pos)))

    # ---- 形狀 ----
    def cuboid(self, key, c, s):
        x0, x1 = c[0] - s[0] / 2, c[0] + s[0] / 2
        y0, y1 = c[1] - s[1] / 2, c[1] + s[1] / 2
        z0, z1 = c[2] - s[2] / 2, c[2] + s[2] / 2
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        self._add(key, v, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)])

    def beam(self, key, p0, p1, w, t, up=(0, 1, 0)):
        """p0 到 p1 的斜樑(寬 w、厚 t),截面朝向由 up 決定;欄杆、窗櫺、瓦壟、藤蔓都用它。"""
        a, b = Vector(p0), Vector(p1)
        ax = (b - a)
        if ax.length < 1e-9:
            return
        ax.normalize()
        u = Vector(up)
        side = ax.cross(u)
        if side.length < 1e-6:
            side = ax.cross(Vector((1, 0, 0)))
        side.normalize()
        nrm = side.cross(ax)
        nrm.normalize()
        o = [side * (w / 2) + nrm * (t / 2), -side * (w / 2) + nrm * (t / 2), -side * (w / 2) - nrm * (t / 2), side * (w / 2) - nrm * (t / 2)]
        v = [tuple(a + d) for d in o] + [tuple(b + d) for d in o]
        self._add(key, v, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])

    def frustum(self, key, y0, y1, bw, bd, tw, td, cx=0.0, cz=0.0):
        """截頭錐(屋頂):底面 bw×bd 在 y0,頂面 tw×td 在 y1。"""
        def rect(w, d, y):
            return [(cx - w / 2, y, cz - d / 2), (cx + w / 2, y, cz - d / 2), (cx + w / 2, y, cz + d / 2), (cx - w / 2, y, cz + d / 2)]
        v = rect(bw, bd, y0) + rect(tw, td, y1)
        self._add(key, v, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])

    def cylinder(self, key, c, r, h, seg=12, smooth=True, r_top=None):
        rt = r if r_top is None else r_top
        v, f = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            v.append((c[0] + math.cos(a) * r, c[1] - h / 2, c[2] + math.sin(a) * r))
        for i in range(seg):
            a = 2 * math.pi * i / seg
            v.append((c[0] + math.cos(a) * rt, c[1] + h / 2, c[2] + math.sin(a) * rt))
        for i in range(seg):
            j = (i + 1) % seg
            f.append((i, j, seg + j, seg + i))
        f.append(tuple(range(seg - 1, -1, -1)))
        f.append(tuple(range(seg, 2 * seg)))
        self._add(key, v, f, smooth)

    def tube(self, key, pts, radii, seg=8, smooth=True, cap_end=True, aspect=1.0):
        """沿折線 pts 掃出的管狀物,每個點一個半徑(漸細):牛角、腿、尾巴、藤蔓。radii 可以是單一數字。
        aspect:截面的「高/寬」比(路徑沿 z、參考上方向 +y 時,寬是水平方向、高是垂直方向),>1 = 縱向拉長,桶狀軀幹用。"""
        pts = [Vector(p) for p in pts]
        rs = [radii] * len(pts) if isinstance(radii, (int, float)) else list(radii)
        v, f = [], []
        prev_n = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
            t.normalize()
            if prev_n is None:
                ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
                n = t.cross(ref)
            else:
                n = prev_n - t * prev_n.dot(t)  # 平行傳遞,避免扭轉
            n.normalize()
            b = t.cross(n)
            prev_n = n
            for j in range(seg):
                a = 2 * math.pi * j / seg
                v.append(tuple(p + n * (math.cos(a) * rs[i]) + b * (math.sin(a) * rs[i] * aspect)))
        for i in range(len(pts) - 1):
            for j in range(seg):
                a, b2 = i * seg + j, i * seg + (j + 1) % seg
                f.append((a, b2, b2 + seg, a + seg))
        f.append(tuple(range(seg - 1, -1, -1)))
        if cap_end:
            f.append(tuple(range((len(pts) - 1) * seg, len(pts) * seg)))
        self._add(key, v, f, smooth)

    def ellipsoid(self, key, c, r, seg=10, rings=6, smooth=True):
        """橢球:r = (rx, ry, rz)。"""
        v, f = [(c[0], c[1] + r[1], c[2])], []
        for j in range(1, rings):
            phi = math.pi * j / rings
            for i in range(seg):
                a = 2 * math.pi * i / seg
                v.append((c[0] + math.sin(phi) * math.cos(a) * r[0], c[1] + math.cos(phi) * r[1], c[2] + math.sin(phi) * math.sin(a) * r[2]))
        v.append((c[0], c[1] - r[1], c[2]))
        for i in range(seg):
            f.append((0, 1 + (i + 1) % seg, 1 + i))
        for j in range(rings - 2):
            for i in range(seg):
                a, b = 1 + j * seg + i, 1 + j * seg + (i + 1) % seg
                f.append((a, b, b + seg, a + seg))
        last = len(v) - 1
        base = 1 + (rings - 2) * seg
        for i in range(seg):
            f.append((last, base + i, base + (i + 1) % seg))
        self._add(key, v, f, smooth)

    # ---- 收尾:轉座標、焊接、建物件、匯出、驗證 ----
    def finalize(self):
        info = {'tris': 0, 'materials': 0, 'bbox_min': [1e9] * 3, 'bbox_max': [-1e9] * 3}
        for key, bm in self.bms.items():
            if not bm.faces:
                continue
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            for v in bm.verts:
                for i in range(3):
                    info['bbox_min'][i] = min(info['bbox_min'][i], v.co[i])
                    info['bbox_max'][i] = max(info['bbox_max'][i], v.co[i])
            info['tris'] += sum(len(f.verts) - 2 for f in bm.faces)
            info['materials'] += 1
            bmesh.ops.transform(bm, matrix=TO_BLENDER, verts=bm.verts)
            mesh = bpy.data.meshes.new(f'{self.name}_{key}')
            bm.to_mesh(mesh)
            bm.free()
            obj = bpy.data.objects.new(f'{self.name}_{key}', mesh)
            obj.data.materials.append(self.mats[key])
            bpy.context.scene.collection.objects.link(obj)
        for name, pos in self.anchors:
            empty = bpy.data.objects.new(name, None)
            empty.empty_display_type = 'PLAIN_AXES'
            empty.empty_display_size = 0.1
            empty.location = TO_BLENDER @ pos
            bpy.context.scene.collection.objects.link(empty)
        info['anchors'] = len(self.anchors)
        info['size'] = [round(info['bbox_max'][i] - info['bbox_min'][i], 3) for i in range(3)]
        info['bbox_min'] = [round(v, 3) for v in info['bbox_min']]
        info['bbox_max'] = [round(v, 3) for v in info['bbox_max']]
        return info


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_materials='EXPORT', export_yup=True)


def render_views(out_prefix, views, size=(640, 480), center=(0, 5, 0), dist=26):
    """views: [(名稱, 方位角度, 仰角度)];方位 0 = 從正面(+z)看,正角度往右(+x)轉。以 EEVEE 渲染,給人或 AI 看形狀用。"""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.20, 0.23, 0.30, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    sc.collection.objects.link(sun)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 40
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new('tgt', None)
    tgt.location = TO_BLENDER @ Vector(center)
    sc.collection.objects.link(tgt)
    con = cam.constraints.new('TRACK_TO')
    con.target, con.track_axis, con.up_axis = tgt, 'TRACK_NEGATIVE_Z', 'UP_Y'
    paths = []
    for name, az, el in views:
        a, e = math.radians(az), math.radians(el)
        p = Vector((center[0] + dist * math.sin(a) * math.cos(e), center[1] + dist * math.sin(e), center[2] + dist * math.cos(a) * math.cos(e)))
        cam.location = TO_BLENDER @ p
        sc.render.filepath = f'{out_prefix}-{name}.png'
        bpy.ops.render.render(write_still=True)
        paths.append(sc.render.filepath)
    return paths


def cli_args():
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else []
