"""Art direction pass: controlled reflections and readable internals."""
import bpy, sys, numpy as np
from pathlib import Path
import os
OUT = Path(os.environ.get("AQUA_OUTPUT_DIR", str(Path(__file__).resolve().parents[3] / "demo-assets/aqua-helix-hd/generated"))).resolve()
bpy.ops.wm.open_mainfile(filepath=str(OUT/'aqua-helix-hd.blend'))
s=bpy.context.scene
light_power={'Key / large softbox':900,'Rim / cool strip':1100,'Fill / copper edge':650,'Front / white':480,'Right / crisp edge':700}
for o in bpy.data.objects:
    if o.type=='LIGHT':o.data.energy=light_power[o.name]
img=bpy.data.images['Machined metal • 1K roughness']
rng=np.random.default_rng(91);n=1024
v=np.clip(.42+rng.normal(0,.075,(n,1))+rng.normal(0,.018,(n,n)),.18,.72).astype(np.float32)
rgba=np.ones((n,n,4),dtype=np.float32);rgba[:,:,:3]=v[:,:,None]
img.colorspace_settings.name='Non-Color';img.pixels.foreach_set(rgba.ravel());img.update()
img.filepath_raw=str(OUT/'textures/brushed-roughness.png');img.file_format='PNG';img.save();img.pack()
for name,alpha in [('06 • Blue inspection shell',.07),('07 • Transparent flow windows',.085)]:
    m=bpy.data.materials[name];m.diffuse_color=(*m.diffuse_color[:3],alpha)
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Alpha'].default_value=alpha
    bs.inputs['Metallic'].default_value=.12;bs.inputs['Roughness'].default_value=.28
s.world.node_tree.nodes['Background'].inputs[1].default_value=.22
gl=next(n for n in s.node_tree.nodes if n.type=='GLARE')
print('GLARE INPUTS', [(x.name,str(x.default_value)) for x in gl.inputs if hasattr(x,'default_value')],flush=True)
gl.inputs['Threshold'].default_value=2.5;gl.inputs['Strength'].default_value=.10;gl.inputs['Size'].default_value=.25
for n in ('01 • Satin titanium','03 • Machined stainless edges','04 • Bare copper windings','02 • Graphite anodized aluminum'):
    m=bpy.data.materials[n];bs=m.node_tree.nodes.get('Principled BSDF')
    tex=next(node for node in m.node_tree.nodes if node.type=='TEX_IMAGE')
    vals=list(tex.image.pixels)[0:400:4];print('Texture sample',n,min(vals),max(vals),flush=True)
s.view_settings.exposure=-.1
s.render.resolution_percentage=60;s.cycles.samples=32
s.render.filepath=str(OUT/'previews/review-refined.png')
bpy.ops.render.render(write_still=True)
# Save art direction and re-export static GLB; pack_animation.py follows.
s.render.resolution_percentage=100;s.render.resolution_x=3840;s.render.resolution_y=2400;s.cycles.samples=96
s.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'aqua-helix-hd.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.collections['01 • AQUA HELIX / export assembly'].objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'aqua-helix-hd.glb'),export_format='GLB',use_selection=True,export_animations=False,export_extras=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False)
print('REFINE COMPLETE',flush=True)
