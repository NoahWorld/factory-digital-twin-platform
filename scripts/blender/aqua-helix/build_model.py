"""AQUA / HELIX — procedural, independently addressable chiller demonstrator.
Blender 4.4. Run with --background --python scripts/build_model.py.
All geometry is original. Units: meters. No third-party asset dependencies.
"""
import bpy, math, json, struct, random, time, sys
import numpy as np
from pathlib import Path
import os
from mathutils import Vector, Quaternion

OUT = Path(os.environ.get("AQUA_OUTPUT_DIR", str(Path(__file__).resolve().parents[3] / "demo-assets/aqua-helix-hd/generated"))).resolve()
for folder in ("scripts", "textures", "previews"):
    (OUT / folder).mkdir(parents=True, exist_ok=True)
TAU = math.tau
START = time.time()
RNG = random.Random(27419)
ANIM = []
PARTS = []
MESH_CACHE = {}
DURATION = 12.0
FPS = 30

def log(s):
    print(f'[AQUA {time.time()-START:6.1f}s] {s}', flush=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = 361

def collection(name):
    c=bpy.data.collections.new(name); scene.collection.children.link(c); return c

PRODUCT=collection('01 • AQUA HELIX / export assembly')
STUDIO=collection('02 • Studio / excluded from GLB')

def group(name, label, parent=None, pos=(0,0,0), category='assembly'):
    o=bpy.data.objects.new(name,None); PRODUCT.objects.link(o)
    o.parent=parent; o.location=pos; o.empty_display_size=.15
    o['label']=label; o['category']=category
    return o

ROOT=group('AQUA_HELIX_HD','双回路离心式水冷机组')
ROOT['units']='meters'; ROOT['assetType']='Original visualization concept'
ROOT['animationDuration']=DURATION
BASE=group('01_Skid','底座与减振支架',ROOT)
EVAP=group('02_Evaporator','蒸发器 / 冷水换热管束',ROOT)
COND=group('03_Condenser','冷凝器 / 散热换热管束',ROOT)
COMP=group('04_Compressor','双级离心压缩机',ROOT)
MOTOR=group('05_Motor','永磁驱动电机',ROOT)
COLD=group('06_Chilled_Water_Loop','冷水闭合回路',ROOT)
HOT=group('07_Cooling_Water_Loop','冷却水闭合回路',ROOT)
AUX=group('08_Auxiliaries','辅助系统与控制仪表',ROOT)
FLOW=group('09_Flow_Animation','流动粒子与水波 / 12 秒循环',ROOT,category='animation')

def mat(name, rgb, metal=0, rough=.3, alpha=1, emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    m.diffuse_color=(*rgb,alpha)
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Metallic'].default_value=metal
    bs.inputs['Roughness'].default_value=rough
    bs.inputs['Alpha'].default_value=alpha
    if emission:
        bs.inputs['Emission Color'].default_value=(*rgb,1)
        bs.inputs['Emission Strength'].default_value=emission
    if alpha<1:
        m.surface_render_method='DITHERED'
        m.use_transparency_overlap=False
        m.use_backface_culling=True
    return m

steel=mat('01 • Satin titanium',(.42,.52,.62),.86,.25)
dark=mat('02 • Graphite anodized aluminum',(.027,.046,.068),.78,.3)
silver=mat('03 • Machined stainless edges',(.67,.76,.82),.93,.19)
copper=mat('04 • Bare copper windings',(.72,.255,.075),.82,.22)
rubber=mat('05 • EPDM gaskets',(.013,.019,.025),.12,.64)
glass=mat('06 • Blue inspection shell',(.13,.42,.62),.35,.17,.15)
pipeglass=mat('07 • Transparent flow windows',(.12,.5,.65),.3,.12,.17)
blue=mat('08 • Chilled circuit cyan',(.025,.60,.93),.36,.24,1,.6)
warm=mat('09 • Warm circuit amber',(.98,.29,.055),.34,.25,1,.7)
blueglow=mat('10 • Cyan tracer emission',(.045,.65,1),.05,.22,1,4)
warmglow=mat('11 • Amber tracer emission',(1,.33,.07),.05,.24,1,3)
white=mat('12 • Porcelain gauge dial',(.76,.86,.88),.1,.34)
ink=mat('13 • Engraved markings',(.015,.033,.048),.1,.42)
glowwhite=mat('14 • Status light',(.48,1,.85),.1,.22,1,2)
finmat=mat('15 • Laminated electrical steel',(.12,.18,.23),.83,.3)

def brushed_texture():
    n=1024; rng=np.random.default_rng(91)
    stripe=rng.normal(0,.075,(n,1))
    grain=rng.normal(0,.018,(n,n))
    v=np.clip(.42+stripe+grain,.18,.72).astype(np.float32)
    rgba=np.ones((n,n,4),dtype=np.float32); rgba[:,:,:3]=v[:,:,None]
    img=bpy.data.images.new('Machined metal • 1K roughness',width=n,height=n)
    img.colorspace_settings.name='Non-Color'; img.pixels.foreach_set(rgba.ravel()); img.update()
    img.filepath_raw=str(OUT/'textures/brushed-roughness.png'); img.file_format='PNG'; img.save(); img.pack()
    for m in (steel,silver,copper,dark):
        tex=m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=img
        m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'])

brushed_texture()

def mesh(name,verts,faces,material,parent,uv=None,smooth=True,category='part'):
    me=bpy.data.meshes.new(name+'_geometry'); me.from_pydata(verts,[],faces); me.update()
    if uv:
        layer=me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            for li in p.loop_indices: layer.data[li].uv=uv[me.loops[li].vertex_index]
    else:
        layer=me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            for li in p.loop_indices:
                v=me.vertices[me.loops[li].vertex_index].co
                layer.data[li].uv=(v.x*.3+v.y*.1,v.z*.3+v.y*.15)
    for p in me.polygons:p.use_smooth=smooth
    me.materials.append(material)
    o=bpy.data.objects.new(name,me); PRODUCT.objects.link(o); o.parent=parent
    o['category']=category
    if material in (glass,pipeglass):o['inspectionShell']=True
    PARTS.append(o)
    return o

def orient(o,axis):
    o.rotation_mode='QUATERNION'; o.rotation_quaternion=Vector((0,0,1)).rotation_difference(Vector(axis).normalized())

def cylinder(name,pos,r,length,material,parent,axis=(1,0,0),n=64,bevel=.008):
    # Turned cylindrical part with modeled chamfers and planar end faces.
    b=min(bevel,r*.2,length*.2)
    levels=[(-length/2,r-b),(-length/2+b,r),(length/2-b,r),(length/2,r-b)]
    key=('cyl',round(r,5),round(length,5),n,round(b,5),material.name)
    if key in MESH_CACHE:
        o=bpy.data.objects.new(name,MESH_CACHE[key]); PRODUCT.objects.link(o);o.parent=parent;o['category']='part';PARTS.append(o)
    else:
        verts=[];uv=[];faces=[]
        for j,(z,rad) in enumerate(levels):
            for i in range(n):
                a=i*TAU/n;verts.append((rad*math.cos(a),rad*math.sin(a),z));uv.append((i/n,j/3))
        for j in range(3):
            for i in range(n):
                ni=(i+1)%n;faces.append((j*n+i,j*n+ni,(j+1)*n+ni,(j+1)*n+i))
        faces.extend([tuple(reversed(range(n))),tuple(range(3*n,4*n))])
        o=mesh(name,verts,faces,material,parent,uv)
        o.data.polygons[-1].use_smooth=False;o.data.polygons[-2].use_smooth=False
        MESH_CACHE[key]=o.data
    o.location=pos;orient(o,axis);return o

def ring(name,pos,outer,inner,depth,material,parent,axis=(1,0,0),n=96):
    key=('ring',round(outer,5),round(inner,5),round(depth,5),n,material.name)
    if key in MESH_CACHE:
        o=bpy.data.objects.new(name,MESH_CACHE[key]);PRODUCT.objects.link(o);o.parent=parent;o['category']='part';PARTS.append(o)
    else:
        verts=[];faces=[];uv=[]
        for z,r in [(-depth/2,outer),(depth/2,outer),(-depth/2,inner),(depth/2,inner)]:
            for i in range(n):
                a=i*TAU/n;verts.append((r*math.cos(a),r*math.sin(a),z));uv.append((i/n,z/depth+.5))
        for i in range(n):
            j=(i+1)%n
            faces.extend([(i,j,n+j,n+i),(2*n+j,2*n+i,3*n+i,3*n+j),(j,i,2*n+i,2*n+j),(n+i,n+j,3*n+j,3*n+i)])
        o=mesh(name,verts,faces,material,parent,uv);MESH_CACHE[key]=o.data
    o.location=pos;orient(o,axis)
    if material in (glass,pipeglass):o['inspectionShell']=True
    return o

def box(name,pos,size,material,parent,bevel=.025):
    x,y,z=[s/2 for s in size]
    verts=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    faces=[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]
    o=mesh(name,verts,faces,material,parent,smooth=False);o.location=pos
    if bevel:
        mod=o.modifiers.new('Machined edge radius','BEVEL');mod.width=bevel;mod.segments=3
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def tube(name,points,r,material,parent,sides=12,closed=False):
    pts=[Vector(p) for p in points];verts=[];uv=[];faces=[];prev=None
    for i,p in enumerate(pts):
        tangent=(pts[(i+1)%len(pts)]-pts[i-1] if closed else pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized()
        ref=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((0,1,0))
        u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        if prev and u.dot(prev)<0:u=-u;v=-v
        prev=u
        for j in range(sides):
            a=j*TAU/sides;verts.append(p+r*(u*math.cos(a)+v*math.sin(a)));uv.append((j/sides,i/(len(pts)-1)))
    for i in range(len(pts) if closed else len(pts)-1):
        ni=(i+1)%len(pts)
        for j in range(sides):
            nj=(j+1)%sides;faces.append((i*sides+j,i*sides+nj,ni*sides+nj,ni*sides+j))
    if not closed:
        faces.extend([tuple(reversed(range(sides))),tuple(range((len(pts)-1)*sides,len(pts)*sides))])
    return mesh(name,verts,faces,material,parent,uv)

def torus(name,pos,major,minor,material,parent,axis=(1,0,0),n=96,m=10):
    key=('torus',round(major,5),round(minor,5),n,m,material.name)
    if key in MESH_CACHE:
        o=bpy.data.objects.new(name,MESH_CACHE[key]);PRODUCT.objects.link(o);o.parent=parent;o['category']='part';PARTS.append(o)
    else:
        pts=[(major*math.cos(i*TAU/n),major*math.sin(i*TAU/n),0) for i in range(n)]
        o=tube(name,pts,minor,material,parent,m,True);MESH_CACHE[key]=o.data
    o.location=pos;orient(o,axis);return o

def sphere(name,pos,r,material,parent):
    key=('sphere',material.name)
    if key not in MESH_CACHE:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1)
        temp=bpy.context.object; me=temp.data;me.materials.append(material)
        for p in me.polygons:p.use_smooth=True
        MESH_CACHE[key]=me;bpy.data.objects.remove(temp,do_unlink=True)
    o=bpy.data.objects.new(name,MESH_CACHE[key]);PRODUCT.objects.link(o);o.parent=parent;o.location=pos;o.scale=(r,r,r);o['category']='flow';PARTS.append(o);return o

def text_obj(name,body,pos,size,material,parent,rotation=(math.pi/2,0,0)):
    cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.size=size;cu.extrude=.0008;cu.bevel_depth=.0003;cu.align_x='CENTER'
    o=bpy.data.objects.new(name,cu);PRODUCT.objects.link(o);o.parent=parent;o.location=pos;o.rotation_euler=rotation;cu.materials.append(material);o['category']='label';PARTS.append(o)
    return o

def bolt_circle(prefix,pos,r,count,parent,axis=(1,0,0),size=.034):
    q=Vector((0,0,1)).rotation_difference(Vector(axis))
    for i in range(count):
        a=TAU*i/count;off=q@Vector((r*math.cos(a),r*math.sin(a),0));p=Vector(pos)+off
        cylinder(f'{prefix}_Washer_{i+1:02}',p,size*1.42,.016,silver,parent,axis,32,.002)
        p2=p+Vector(axis)*.024
        cylinder(f'{prefix}_HexBolt_{i+1:02}',p2,size,.038,dark,parent,axis,6,.003)
        cylinder(f'{prefix}_Socket_{i+1:02}',p2+Vector(axis)*.020,size*.38,.002,ink,parent,axis,6,0)

def flange(prefix,pos,parent,axis=(1,0,0),r=.25):
    ring(prefix+'_Gasket',pos,r*.97,.133,.026,rubber,parent,axis)
    for sign in (-1,1):
        p=Vector(pos)+Vector(axis)*sign*.053
        ring(prefix+f'_Flange_{sign}',p,r,.134,.06,steel,parent,axis)
        bolt_circle(prefix+f'_Fastener_{sign}',p+Vector(axis)*sign*.035,r*.82,8,parent,tuple(Vector(axis)*sign),.023)

def rounded_path(corners,r=.3,closed=True):
    points=[]; vs=[Vector(p) for p in corners]
    for i,p in enumerate(vs):
        if not closed and i in (0,len(vs)-1):points.append(tuple(p));continue
        before=vs[i-1];after=vs[(i+1)%len(vs)]
        cut=min(r,(p-before).length*.42,(after-p).length*.42)
        a=p+(before-p).normalized()*cut;b=p+(after-p).normalized()*cut
        for j in range(13):
            t=j/12;points.append(tuple((1-t)**2*a+2*(1-t)*t*p+t*t*b))
    return points

log('Building skid and serviceable supports')
for y in (-1.66,1.66):
    box(f'Skid_MainRail_{y}',(0,y,.34),(8.25,.18,.30),dark,BASE,.028)
    box(f'Skid_SilverTrim_{y}',(0,y-.1,.43),(8.05,.017,.024),silver,BASE,.003)
for x in (-3.75,-2,0,2,3.75):
    box(f'Skid_Crossmember_{x}',(x,0,.35),(.15,3.44,.2),steel,BASE,.025)
for x in (-3.5,3.5):
    for y in (-1.66,1.66):
        cylinder(f'Mount_Isolator_{x}_{y}',(x,y,.13),.20,.16,rubber,BASE,(0,0,1))
        box(f'Mount_Foot_{x}_{y}',(x,y,.045),(.5,.4,.07),steel,BASE,.024)
        cylinder(f'Mount_Anchor_{x}_{y}',(x,y,.255),.06,.09,silver,BASE,(0,0,1),6)

def heat_exchanger(prefix,y,parent,accent):
    z=1.25; radius=.60
    ring(prefix+'_InspectionShell',(0,y,z),radius,radius-.012,5.48,glass,parent,n=128)
    for x in np.linspace(-2.72,2.72,15):torus(prefix+f'_ShellContour_{x:.2f}',(x,y,z),radius+.002,.005,steel,parent,n=128,m=6)
    for a in (0,math.pi/2,math.pi,3*math.pi/2):
        yy=y+radius*math.cos(a);zz=z+radius*math.sin(a)
        tube(prefix+f'_Seam_{a:.2f}',[(-2.72,yy,zz),(2.72,yy,zz)],.008,silver,parent,8)
    # Individual heat exchange tubes in a hexagonal array.
    count=0
    for row in range(-4,5):
        for col in range(-4,5):
            dy=(col+.5*(row%2))*.112;dz=row*.099
            if dy*dy+dz*dz>.465**2:continue
            count+=1
            ring(prefix+f'_CopperTube_{count:03}',(0,y+dy,z+dz),.035,.026,5.56,copper,parent,n=24)
    for j,x in enumerate(np.linspace(-2.18,2.18,6)):
        ring(prefix+f'_Baffle_{j:02}',(float(x),y,z),.562,.48,.026,steel,parent,n=96)
        for a in (0,TAU/3,2*TAU/3):
            tube(prefix+f'_BaffleBrace_{j}_{a:.2f}',[(x,y,z),(x,y+.53*math.cos(a),z+.53*math.sin(a))],.016,finmat,parent,8)
    for sign in (-1,1):
        x=sign*2.8
        ring(prefix+f'_TubeSheet_{sign}',(x,y,z),.635,.48,.105,steel,parent,n=128)
        torus(prefix+f'_Seal_{sign}',(x-sign*.067,y,z),.592,.019,rubber,parent)
        cylinder(prefix+f'_Waterbox_{sign}',(x+sign*.18,y,z),.57,.23,dark,parent,n=128,bevel=.045)
        ring(prefix+f'_EndRim_{sign}',(x+sign*.30,y,z),.57,.49,.07,silver,parent,n=128)
        cylinder(prefix+f'_EndPanel_{sign}',(x+sign*.34,y,z),.485,.055,dark,parent,n=128,bevel=.015)
        bolt_circle(prefix+f'_Cover_{sign}',(x+sign*.40,y,z),.54,16,parent,(sign,0,0),.032)
        torus(prefix+f'_CircuitBand_{sign}',(x+sign*.375,y,z),.44,.015,accent,parent)
    for x in (-1.85,1.85):
        box(prefix+f'_SaddleFoot_{x}',(x,y,.58),(.44,.95,.14),steel,parent)
        for yy in (-.38,.38):box(prefix+f'_SaddleWeb_{x}_{yy}',(x,y+yy,.80),(.16,.13,.43),dark,parent)
        ring(prefix+f'_SaddleClamp_{x}',(x,y,z),.64,.606,.17,dark,parent,n=96)
        for yy in (-.38,.38):bolt_circle(prefix+f'_SaddleBolts_{x}_{yy}',(x,y+yy,.675),.08,4,parent,(0,0,1),.022)
    text_obj(prefix+'_ID',prefix.upper()+' / 061 TUBES',(0,y-.618,1.20),.10,white,parent)
    return count

log('Building two complete shell-and-tube heat exchangers')
counts=[heat_exchanger('Evaporator',-.85,EVAP,blue),heat_exchanger('Condenser',.85,COND,warm)]

# Upper compressor and motor share a mechanically connected X axis.
Z=3.02
log('Building motor internals, bearings and dual centrifugal impellers')
for x in (-1.7,1.65):
    for y in (-.51,.51):
        box(f'Upper_BearingLeg_{x}_{y}',(x,y,2.17),(.18,.18,.73),steel,COMP)
    box(f'Upper_Cradle_{x}',(x,0,2.48),(.46,1.30,.17),dark,COMP)

ring('Compressor_InspectionShell',(-1.40,0,Z),.84,.818,1.44,glass,COMP,n=160)
for x in (-2.15,-.68):
    ring(f'Compressor_HousingFlange_{x}',(x,0,Z),.88,.66,.115,steel,COMP,n=128)
    bolt_circle(f'Compressor_CaseBolts_{x}',(x-.075,0,Z),.775,20,COMP,(-1,0,0),.037)
    torus(f'Compressor_BlueEdge_{x}',(x-.065,0,Z),.855,.011,blue,COMP)
for x in np.linspace(-2.1,-.70,9):torus(f'Compressor_ShellRing_{x:.2f}',(x,0,Z),.843,.005,steel,COMP,n=128,m=6)
ring('Compressor_InletBell',(-2.24,0,Z),.62,.41,.20,silver,COMP,n=128)
ring('Compressor_InletInspection',(-2.40,0,Z),.41,.385,.18,pipeglass,COMP)
ring('Compressor_BearingHousing',(-.50,0,Z),.36,.19,.28,dark,COMP)
for x in (-.61,-.39):ring(f'Bearing_Race_{x}',(x,0,Z),.25,.175,.055,silver,COMP)
for i in range(12):
    a=i*TAU/12;sphere(f'Bearing_Ball_{i:02}',(-.5,.216*math.cos(a),Z+.216*math.sin(a)),.04,silver,COMP)
rotor=group('Motor_Rotor','转子、主轴与叶轮',MOTOR,(-.5,0,Z),category='rotating')
cylinder('Rotor_MainShaft',(.35,0,0),.135,4.05,silver,rotor,n=96)
cylinder('Rotor_LaminatedCore',(1.50,0,0),.375,1.62,finmat,rotor,n=96)
for i in range(28):
    a=i*TAU/28
    pts=[(.67,.386*math.cos(a),.386*math.sin(a)),(2.30,.386*math.cos(a+.19),.386*math.sin(a+.19))]
    tube(f'Rotor_Conductor_{i:02}',pts,.018,copper,rotor,10)
for xx in (.65,2.33):ring(f'Rotor_EndRing_{xx}',(xx,0,0),.394,.33,.08,copper,rotor)
for stage,xx in enumerate((-1.34,-.76)):
    cylinder(f'Impeller_{stage}_Backplate',(xx,0,0),.64,.045,silver,rotor,n=128)
    cylinder(f'Impeller_{stage}_Hub',(xx-.10,0,0),.235,.22,copper,rotor,n=96,bevel=.045)
    for k in range(13):
        verts=[];faces=[]
        for j in range(22):
            t=j/21;r=.19+.445*t;a=k*TAU/13+.68*t
            for dx,da in ((0,-.011),(0,.011),(.17*(1-.35*t),-.011),(.17*(1-.35*t),.011)):
                verts.append((xx-.025-dx,r*math.cos(a+da),r*math.sin(a+da)))
        for j in range(21):
            b=j*4;c=b+4
            faces.extend([(b,c,c+1,b+1),(b+2,b+3,c+3,c+2),(b,b+2,c+2,c),(b+1,c+1,c+3,b+3)])
        faces.extend([(0,1,3,2),(84,86,87,85)])
        mesh(f'Impeller_{stage}_CurvedBlade_{k:02}',verts,faces,silver,rotor)

ring('Motor_InspectionShell',(1.27,0,Z),.69,.676,2.18,glass,MOTOR,n=160)
for x in (.16,2.37):
    ring(f'Motor_EndBell_{x}',(x,0,Z),.725,.44,.16,dark,MOTOR,n=128)
    ring(f'Motor_MachinedLip_{x}',(x-.086,0,Z),.71,.64,.035,silver,MOTOR)
    bolt_circle(f'Motor_EndFasteners_{x}',(x-.11,0,Z),.59,16,MOTOR,(-1,0,0),.028)
for i,x in enumerate(np.linspace(.29,2.22,25)):
    ring(f'Motor_Lamination_{i:02}',(float(x),0,Z),.574,.495,.026,finmat,MOTOR,n=96)
for k in range(24):
    a=k*TAU/24
    # Individually wound copper loops with curved end turns.
    for layer in range(3):
        rr=.582+layer*.022;pts=[]
        for j in range(96):
            t=j*TAU/96
            x=1.255+1.03*math.cos(t)
            theta=a+.082*math.sin(t)
            pts.append((x,rr*math.cos(theta),Z+rr*math.sin(theta)))
        tube(f'Stator_Coil_{k:02}_Turn_{layer}',pts,.0105,copper,MOTOR,8,True)
for a in (math.pi/4,3*math.pi/4,5*math.pi/4,7*math.pi/4):
    yy=.665*math.cos(a);zz=Z+.665*math.sin(a)
    cylinder(f'Motor_TieRod_{a:.2f}',(1.25,yy,zz),.021,2.44,silver,MOTOR,n=24)
ring('Motor_RearFanGuard',(2.60,0,Z),.57,.49,.22,dark,MOTOR)
for i in range(9):torus(f'Motor_FanGrille_{i}',(2.73,0,Z),.08+i*.052,.009,silver,MOTOR,n=64,m=8)
for i in range(8):
    a=i*TAU/8;tube(f'Motor_FanGrilleSpoke_{i}',[(2.74,0,Z),(2.74,.51*math.cos(a),Z+.51*math.sin(a))],.009,silver,MOTOR,8)
fan=group('Motor_Fan','冷却风扇',MOTOR,(2.57,0,Z),category='rotating')
for i in range(9):
    a=i*TAU/9
    verts=[(0,.08*math.cos(a),.08*math.sin(a)),(.035,.46*math.cos(a+.22),.46*math.sin(a+.22)),(-.065,.46*math.cos(a+.53),.46*math.sin(a+.53)),(-.035,.08*math.cos(a+.53),.08*math.sin(a+.53))]
    o=mesh(f'Motor_FanBlade_{i}',verts,[(0,1,2,3)],silver,fan)
    mod=o.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.012
box('Motor_TerminalBox',(1.4,.13,3.87),(.77,.65,.32),dark,MOTOR,.045)
box('Motor_TerminalLid',(1.4,.13,4.04),(.83,.70,.05),steel,MOTOR,.016)
text_obj('Motor_Brand','A Q U A  /  H E L I X',(1.30,-.698,Z-.10),.093,white,MOTOR)

def valve(prefix,pos,parent,accent):
    x,y,z=pos
    cylinder(prefix+'_Body',pos,.21,.40,steel,parent,n=64,bevel=.035)
    for dx in (-.25,.25):flange(prefix+f'_Flange_{dx}',(x+dx,y,z),parent)
    cylinder(prefix+'_Bonnet',(x,y,z+.23),.12,.32,dark,parent,(0,0,1))
    cylinder(prefix+'_Stem',(x,y,z+.47),.034,.35,silver,parent,(0,0,1),32)
    ring(prefix+'_PackingGland',(x,y,z+.39),.10,.035,.04,copper,parent,(0,0,1))
    torus(prefix+'_Handwheel',(x,y,z+.67),.25,.026,accent,parent,(0,0,1),64,12)
    cylinder(prefix+'_HandwheelHub',(x,y,z+.67),.065,.07,steel,parent,(0,0,1),32)
    for i in range(5):
        a=i*TAU/5;tube(prefix+f'_WheelSpoke_{i}',[(x,y,z+.67),(x+.23*math.cos(a),y+.23*math.sin(a),z+.67)],.016,dark,parent,10)

def gauge(prefix,pos,parent,accent):
    x,y,z=pos
    tube(prefix+'_ImpulseLine',[(x,y,z-.40),(x,y,z)],.023,silver,parent,12)
    cylinder(prefix+'_GaugeBody',pos,.165,.093,dark,parent,(0,-1,0),96)
    cylinder(prefix+'_Dial',(x,y-.050,z),.145,.01,white,parent,(0,-1,0),96,0)
    torus(prefix+'_Bezel',(x,y-.066,z),.155,.018,silver,parent,(0,-1,0))
    for i in range(31):
        a=math.radians(-40+i*260/30);r=.128;inner=.103 if i%5==0 else .116
        tube(prefix+f'_Tick_{i:02}',[(x+r*math.cos(a),y-.061,z+r*math.sin(a)),(x+inner*math.cos(a),y-.061,z+inner*math.sin(a))],.0023,ink,parent,6)
    tube(prefix+'_Needle',[(x+.045,y-.071,z-.030),(x-.077,y-.071,z+.070)],.0055,accent,parent,8)
    cylinder(prefix+'_Pin',(x,y-.077,z),.016,.010,silver,parent,(0,-1,0),24)
    text_obj(prefix+'_Unit','MPa',(x,y-.071,z-.077),.028,ink,parent)

log('Building closed pipe circuits, flanges, valves and gauges')
cold_path=rounded_path([(-2.55,-.85,1.25),(-3.68,-.85,1.25),(-3.68,-1.85,1.25),(-3.68,-1.85,2.43),(3.50,-1.85,2.43),(3.50,-1.85,1.25),(3.50,-.85,1.25),(2.55,-.85,1.25)],.32)
hot_path=rounded_path([(2.55,.85,1.25),(3.50,.85,1.25),(3.50,1.73,1.25),(3.50,1.73,2.58),(-3.68,1.73,2.58),(-3.68,1.73,1.25),(-3.68,.85,1.25),(-2.55,.85,1.25)],.32)
for name,path,parent,accent in [('Chilled',cold_path,COLD,blue),('Cooling',hot_path,HOT,warm)]:
    o=tube(name+'_TransparentPipe',path,.137,pipeglass,parent,32,True);o['inspectionShell']=True
    # Twin thin witness lines preserve a readable pipe contour.
    for sign in (-1,1):tube(name+f'_PipeSeam_{sign}',[(x,y+sign*.126,z) for x,y,z in path],.004,steel,parent,6,True)
    yy=-1.85 if name=='Chilled' else 1.73;zz=2.43 if name=='Chilled' else 2.58
    for xx in (-2.8,-.75,1.3,2.95):
        flange(name+f'_Union_{xx}',(xx,yy,zz),parent)
    valve(name+'_IsolationValve',(-1.9,yy,zz),parent,accent)
    valve(name+'_RegulationValve',(2.3,yy,zz),parent,accent)
    gauge(name+'_PressureGauge',(-.85,yy-.025,zz+.47),parent,accent)
    for xx in (-2.8,2.95):
        tube(name+f'_PipeSupport_{xx}',[(xx,yy,.45),(xx,yy,zz-.15)],.024,steel,parent,12)
        torus(name+f'_Clamp_{xx}',(xx,yy,zz),.156,.018,dark,parent)

# Suction and discharge connect the compressor to the two exchanger shells.
for name,points in [('Suction',[(-2.44,0,Z),(-2.83,0,Z),(-2.83,-.85,2.55),(-1.7,-.85,2.55),(-1.7,-.85,1.85)]),('Discharge',[(-1.3,0,3.83),(-1.3,.75,4.08),(-2.35,.85,4.08),(-2.35,.85,1.85)])]:
    pp=rounded_path(points,.24,False);tube(name+'_RefrigerantLine',pp,.16,steel,AUX,32)
    for p in (points[0],points[-1]):flange(name+f'_Joint_{p[2]}',p,AUX,(0,0,1),.265)

def pump(prefix,x,y,parent,accent):
    z=.93
    box(prefix+'_Mount',(x,y,.53),(.78,.55,.15),dark,parent)
    cylinder(prefix+'_Motor',(x,y,z),.255,.65,dark,parent,(0,1,0),96,.035)
    for i in range(18):
        a=i*TAU/18
        box(prefix+f'_CoolingFin_{i}',(x+.26*math.cos(a),y,z+.26*math.sin(a)),(.023,.55,.045),steel,parent,.004).rotation_euler[1]=-a
    ring(prefix+'_Volute',(x,y-.43,z),.35,.285,.24,steel,parent,(0,1,0))
    cylinder(prefix+'_Window',(x,y-.57,z),.28,.025,glass,parent,(0,1,0),96,0)['inspectionShell']=True
    bolt_circle(prefix+'_PumpCover',(x,y-.59,z),.31,10,parent,(0,-1,0),.024)
    imp=group(prefix+'_Impeller','循环泵叶轮',parent,(x,y-.44,z),category='rotating')
    cylinder(prefix+'_ImpellerHub',(0,0,0),.08,.15,copper,imp,(0,1,0),32)
    for i in range(8):
        a=i*TAU/8
        pts=[((.08+.16*t)*math.cos(a+.7*t),0,(.08+.16*t)*math.sin(a+.7*t)) for t in np.linspace(0,1,20)]
        tube(prefix+f'_ImpellerBlade_{i}',pts,.017,copper,imp,8)
    pp=rounded_path([(x,y-.44,z+.29),(x,y-.44,1.50),(x,(-1.85 if y<0 else 1.73),1.50)],.13,False)
    tube(prefix+'_Outlet',pp,.08,steel,parent,24)
    return imp

pump1=pump('Chilled_Pump',3.65,-.42,COLD,blue)
pump2=pump('Cooling_Pump',3.65,.90,HOT,warm)

# Oil separator, service hardware, control cabinet and sensors.
cylinder('Oil_Separator',(-3.18,.48,2.37),.235,1.03,dark,AUX,(0,0,1),96,.06)
for z in (1.87,2.87):ring(f'Oil_SeparatorCap_{z}',(-3.18,.48,z),.25,.15,.065,steel,AUX,(0,0,1))
tube('Oil_Return',rounded_path([(-3.18,.48,1.89),(-3.18,0,1.75),(-.4,0,1.75),(-.4,0,2.75)],.14,False),.034,copper,AUX,16)
tube('Oil_Supply',rounded_path([(-3.18,.48,2.88),(-3.18,.48,3.32),(-.55,.48,3.32),(-.55,0,3.32)],.14,False),.027,silver,AUX,16)
box('Control_Cabinet',(2.10,1.26,3.02),(.82,.40,.96),dark,AUX,.045)
box('Control_Door',(2.10,1.035,3.02),(.75,.055,.88),steel,AUX,.023)
box('Control_Display',(2.10,.998,3.16),(.54,.016,.30),ink,AUX,.015)
text_obj('Control_Readout','AQUA  /  HX-02',(2.10,.984,3.20),.048,glowwhite,AUX)
text_obj('Control_Status','DEMO  •  FLOW',(2.10,.984,3.09),.038,blueglow,AUX)
for i,m in enumerate((glowwhite,blue,warm)):
    cylinder(f'Control_Button_{i}',(1.90+i*.20,.99,2.79),.035,.03,m,AUX,(0,-1,0),32)
for z in (2.76,3.28):box(f'Control_Hinge_{z}',(1.72,1.014,z),(.034,.052,.11),dark,AUX,.006)
box('Control_Handle',(2.42,.969,3.0),(.027,.04,.15),dark,AUX,.006)
tube('Motor_PowerConduit',rounded_path([(1.72,.45,3.85),(2.20,.64,3.85),(2.20,1.24,3.55)],.14,False),.045,rubber,AUX,16)
for i in range(20):torus(f'Conduit_Corrugation_{i}',(1.77+i*.02,.49,3.85),.048,.008,dark,AUX,n=24,m=8)
for parent,y in ((EVAP,-.85),(COND,.85)):
    for x in (-1.1,1.15):
        cylinder(f'{parent.name}_SensorStem_{x}',(x,y,1.94),.025,.24,silver,parent,(0,0,1),24)
        box(f'{parent.name}_SensorHead_{x}',(x,y,2.09),(.14,.14,.12),dark,parent,.02)
    cylinder(f'{parent.name}_Drain',(0,y,.56),.048,.20,copper,parent,(0,0,1),24)

# Engraved industrial identification plate, raised lettering and fasteners.
box('Skid_Nameplate',(0,-1.78,.41),(2.34,.025,.235),dark,BASE,.012)
text_obj('Skid_Identity','A Q U A  /  H E L I X     —     H X - 0 2',(0,-1.797,.422),.067,white,BASE)
text_obj('Skid_Subtitle','DUAL LOOP   /   WATER-COOLED CHILLER',(0,-1.797,.354),.035,blue,BASE)
for x in (-1.10,1.10):cylinder(f'Nameplate_Screw_{x}',(x,-1.806,.41),.018,.01,silver,BASE,(0,-1,0),24,.002)

def sample_path(points,t,closed=True):
    vs=np.array(points,dtype=float)
    if closed:vs=np.vstack([vs,vs[0]])
    distances=np.linalg.norm(np.diff(vs,axis=0),axis=1);cum=np.r_[0,np.cumsum(distances)]
    d=(t%1)*cum[-1];i=min(np.searchsorted(cum,d,side='right')-1,len(distances)-1)
    u=(d-cum[i])/distances[i]
    p=vs[i]*(1-u)+vs[i+1]*u;tangent=(vs[i+1]-vs[i])/distances[i]
    return Vector(p),Vector(tangent)

def animate(o,path,values,times):
    ANIM.append({'name':o.name,'path':path,'times':times,'values':values})
    prop={'translation':'location','rotation':'rotation_quaternion','scale':'scale'}[path]
    if path=='rotation':o.rotation_mode='QUATERNION'
    for sec,val in zip(times,values):
        setattr(o,prop,Quaternion((val[3],val[0],val[1],val[2])) if path=='rotation' else val)
        o.keyframe_insert(data_path=prop,frame=1+sec*FPS,group='AQUA HELIX • Operation')
    action=o.animation_data.action
    for fc in action.fcurves:
        for kp in fc.keyframe_points:kp.interpolation='LINEAR'

log('Baking standard transform animation for water particles and traveling wave rings')
times=[i*DURATION/180 for i in range(181)]
for name,path,material in [('Cold',cold_path,blueglow),('Warm',hot_path,warmglow)]:
    for i in range(136):
        phase=i/136;angle=RNG.uniform(0,TAU);radius=RNG.uniform(.015,.09)
        o=sphere(f'Flow_{name}_Particle_{i:03}',(0,0,0),RNG.uniform(.012,.025),material,FLOW)
        vals=[]
        for t in times:
            p,d=sample_path(path,phase+t/DURATION)
            u=d.cross(Vector((0,0,1)) if abs(d.z)<.9 else Vector((0,1,0))).normalized();v=d.cross(u).normalized()
            a=angle+t*TAU/DURATION*3
            vals.append(tuple(p+radius*(u*math.cos(a)+v*math.sin(a))))
        animate(o,'translation',vals,times)
    for i in range(16):
        o=torus(f'Flow_{name}_Wave_{i:02}',(0,0,0),.105,.005,material,FLOW,(0,0,1),32,6);o['category']='flow'
        vals=[];rots=[]
        for t in times:
            p,d=sample_path(path,i/16+t/DURATION)
            q=Vector((0,0,1)).rotation_difference(d)
            vals.append(tuple(p));rots.append((q.x,q.y,q.z,q.w))
        animate(o,'translation',vals,times);animate(o,'rotation',rots,times)

# Closed return paths through visible exchanger tubes; no particles teleport.
for name,y,material in [('Evap',-.85,blueglow),('Cond',.85,warmglow)]:
    for lane in range(4):
        zz=1.25+(lane-1.5)*.11
        pth=rounded_path([(-2.70,y-.19,zz),(2.70,y-.19,zz),(2.70,y+.19,zz),(-2.70,y+.19,zz)],.16)
        for i in range(10):
            o=sphere(f'Flow_{name}_Tube_{lane}_{i}',(0,0,0),.018,material,FLOW)
            animate(o,'translation',[tuple(sample_path(pth,i/10+t/DURATION*2)[0]) for t in times],times)

for o,axis,revs in [(rotor,(1,0,0),12),(fan,(1,0,0),18),(pump1,(0,1,0),12),(pump2,(0,1,0),12)]:
    tt=[i*DURATION/288 for i in range(289)]
    vals=[]
    for t in tt:
        q=Quaternion(axis,t/DURATION*TAU*revs);vals.append((q.x,q.y,q.z,q.w))
    animate(o,'rotation',vals,tt)
scene.frame_set(1)

# Studio environment is deliberately excluded from portable model exports.
log(f'Geometry ready: {len(PARTS)} mesh/label objects. Creating studio lighting')
floor=box('Studio_Ground',(0,0,-.12),(200,200,.12),mat('Studio • Midnight',(.009,.017,.029),.42,.3),None,.02)
for c in list(floor.users_collection):c.objects.unlink(floor)
STUDIO.objects.link(floor);PARTS.remove(floor)
for x in np.arange(-5,5.01,.5):
    o=tube(f'Studio_GridX_{x}',[(x,-3.5,-.053),(x,3.5,-.053)],.003,mat('GridX'+str(x),(.025,.10,.16),.2,.5),None,4)
    PRODUCT.objects.unlink(o);STUDIO.objects.link(o);PARTS.remove(o)
for y in np.arange(-3.5,3.51,.5):
    o=tube(f'Studio_GridY_{y}',[(-5,y,-.052),(5,y,-.052)],.003,blue,None,4)
    PRODUCT.objects.unlink(o);STUDIO.objects.link(o);PARTS.remove(o)

def track(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
def area(name,pos,power,color,size,target,size_y=None):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=color;d.shape='RECTANGLE';d.size=size;d.size_y=size_y or size
    o=bpy.data.objects.new(name,d);STUDIO.objects.link(o);o.location=pos;track(o,target)
area('Key / large softbox',(0,-4.5,8),2300,(.78,.88,1),7,(0,0,1.5),5)
area('Rim / cool strip',(1,4.0,6),2800,(.32,.66,1),6,(0,0,2),2)
area('Fill / copper edge',(-5,-.5,4),1700,(1,.67,.40),5,(0,0,2),3)
area('Front / white',(-1,-7,3),1200,(.75,.89,1),6,(0,0,2),3)
area('Right / crisp edge',(5,1,5),1800,(.62,.80,1),4,(1,0,2),2)
world=bpy.data.worlds.new('Midnight studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.06,.10,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.4
camdata=bpy.data.cameras.new('Hero camera');cam=bpy.data.objects.new('Hero camera',camdata);STUDIO.objects.link(cam)
cam.location=(-10.6,-14.6,9.0);track(cam,(0,0,1.86));camdata.type='ORTHO';camdata.ortho_scale=11.2;camdata.lens=50;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.cycles.max_bounces=8;scene.cycles.transparent_max_bounces=16
scene.render.resolution_x=2560;scene.render.resolution_y=1600;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.use_nodes=True;nodes=scene.node_tree.nodes;nodes.clear()
rl=nodes.new('CompositorNodeRLayers');gl=nodes.new('CompositorNodeGlare');gl.glare_type='FOG_GLOW';gl.quality='HIGH';gl.inputs['Threshold'].default_value=2.5;gl.inputs['Strength'].default_value=.10
out=nodes.new('CompositorNodeComposite');scene.node_tree.links.new(rl.outputs['Image'],gl.inputs['Image']);scene.node_tree.links.new(gl.outputs['Image'],out.inputs['Image'])

for area_ in bpy.context.screen.areas if bpy.context.screen else []:
    if area_.type=='VIEW_3D':
        area_.spaces.active.region_3d.view_perspective='CAMERA'
        area_.spaces.active.shading.type='MATERIAL'
        area_.spaces.active.clip_end=500
bpy.ops.object.select_all(action='DESELECT');ROOT.select_set(True);bpy.context.view_layer.objects.active=ROOT
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'aqua-helix-hd.blend'))

log('Exporting original node hierarchy and embedded PBR materials')
bpy.ops.object.select_all(action='DESELECT')
for o in PRODUCT.objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'aqua-helix-hd.glb'),export_format='GLB',use_selection=True,export_animations=False,export_extras=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False,export_materials='EXPORT',export_image_format='AUTO')
(OUT/'scripts/animation-tracks.json').write_text(json.dumps(ANIM,separators=(',',':')))
inventory=[{'name':o.name,'parent':o.parent.name if o.parent else None,'category':o.get('category','part'),'shell':o.get('inspectionShell',False),'material':o.data.materials[0].name if o.type in ('MESH','FONT') and o.data.materials else None} for o in PRODUCT.objects]
(OUT/'parts-manifest.json').write_text(json.dumps({'asset':'AQUA HELIX HX-02','units':'meter','tubeCounts':counts,'objects':inventory},ensure_ascii=False,indent=2))
log('Export complete. Rendering review image')
scene.render.resolution_percentage=60;scene.cycles.samples=24
scene.render.filepath=str(OUT/'previews/review.png');bpy.ops.render.render(write_still=True)
log('DONE — scene, static GLB, animation tracks and review image written')
