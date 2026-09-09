"""Reimport the deliverable GLB, verify actual animation, render 4K evidence."""
import bpy, json, math
from pathlib import Path
import os
from mathutils import Vector
OUT = Path(os.environ.get("AQUA_OUTPUT_DIR", str(Path(__file__).resolve().parents[3] / "demo-assets/aqua-helix-hd/generated"))).resolve()
bpy.ops.wm.open_mainfile(filepath=str(OUT/'aqua-helix-hd.blend'))
s=bpy.context.scene
# Replace source product with portable exported product; keep the same studio.
for o in list(bpy.data.collections['01 • AQUA HELIX / export assembly'].objects):bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'aqua-helix-hd.glb'))
root=bpy.data.objects['AQUA_HELIX_HD']
nodes=[root]+list(root.children_recursive)
assert len(nodes)==2742, f'Imported node count {len(nodes)}'
assert sum(o.type=='MESH' for o in nodes)==2728
particle=bpy.data.objects['Flow_Cold_Particle_000'];rotor=bpy.data.objects['Motor_Rotor']
print('Imported action frame ranges',[(a.name,tuple(a.frame_range)) for a in bpy.data.actions if a.users>0][:5],flush=True)
# glTF t=0 imports at Blender frame 0; the authoring scene starts at frame 1.
s.frame_set(0);p0=particle.matrix_world.translation.copy();q0=rotor.rotation_quaternion.copy()
s.frame_set(45);p1=particle.matrix_world.translation.copy();q1=rotor.rotation_quaternion.copy()
assert (p1-p0).length>.2, 'Imported water particle is static'
assert abs(q0.dot(q1))<.99, 'Imported rotor is static'
s.frame_set(360);p2=particle.matrix_world.translation.copy()
assert (p2-p0).length<1e-4, f'Imported loop has a discontinuity: {tuple(p0)} -> {tuple(p2)}'
bounds=[o.matrix_world@Vector(c) for o in nodes if o.type=='MESH' for c in o.bound_box]
bbmin=[min(p[i] for p in bounds) for i in range(3)];bbmax=[max(p[i] for p in bounds) for i in range(3)]
report=json.loads((OUT/'validation-report.json').read_text())
report['blenderReimport']={'passed':True,'nodes':len(nodes),'particleDisplacementAt1_5s':(p1-p0).length,'rotorQuaternionDotAt1_5s':q0.dot(q1),'loopPositionError':(p2-p0).length,'boundsMetersZUp':{'min':bbmin,'max':bbmax}}
(OUT/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('GLB REIMPORT VERIFIED',report['blenderReimport'],flush=True)
s.frame_set(41);s.render.resolution_x=3840;s.render.resolution_y=2400;s.render.resolution_percentage=100;s.cycles.samples=72
s.render.filepath=str(OUT/'previews/aqua-helix-4k.png');bpy.ops.render.render(write_still=True)
print('4K HERO COMPLETE',flush=True)
# Cutaway close-up from imported asset, with only inspectable skins hidden.
for o in nodes:
    if o.get('inspectionShell'):o.hide_render=True
s.camera.location=(-6.2,-7.8,5.8);s.camera.rotation_euler=(Vector((-.3,0,2.75))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=6.4
s.render.resolution_x=2560;s.render.resolution_y=1600;s.cycles.samples=56
s.render.filepath=str(OUT/'previews/internal-detail.png');bpy.ops.render.render(write_still=True)
print('DETAIL COMPLETE',flush=True)
