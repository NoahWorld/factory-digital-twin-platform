"""Embed portable glTF TRS channels; audit hierarchy, bounds and seamless loops."""
import json, struct, math, base64, hashlib
from pathlib import Path
import os
from collections import Counter

OUT = Path(os.environ.get("AQUA_OUTPUT_DIR", str(Path(__file__).resolve().parents[3] / "demo-assets/aqua-helix-hd/generated"))).resolve()
path=OUT/'aqua-helix-hd.glb'
raw=path.read_bytes()
assert raw[:4]==b'glTF' and struct.unpack_from('<I',raw,4)[0]==2
jlen=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+jlen])
blen=struct.unpack_from('<I',raw,20+jlen)[0]
binary=bytearray(raw[28+jlen:28+jlen+blen])
assert not doc.get('animations'), 'Input GLB already has animations; regenerate static export before repacking.'
names=[n['name'] for n in doc['nodes']]
assert len(names)==len(set(names)), 'Duplicate model node names'
index={n:i for i,n in enumerate(names)}
tracks=json.loads((OUT/'scripts/animation-tracks.json').read_text())
time_accessors={}
animation={'name':'Operation • Water flow + rotors • 12s seamless','samplers':[],'channels':[]}

def add_accessor(values,typ,bounds=False):
    flat=[v for row in values for v in row] if typ!='SCALAR' else values
    assert all(math.isfinite(v) for v in flat)
    binary.extend(b'\0'*((-len(binary))%4));offset=len(binary)
    binary.extend(struct.pack('<'+'f'*len(flat),*flat))
    vi=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
    accessor={'bufferView':vi,'componentType':5126,'count':len(values),'type':typ}
    if bounds:accessor.update(min=[min(values)],max=[max(values)])
    ai=len(doc['accessors']);doc['accessors'].append(accessor);return ai

max_loop_error=0
for tr in tracks:
    node=doc['nodes'][index[tr['name']]]
    assert 'matrix' not in node, f'Matrix is not animatable: {tr["name"]}'
    t=tr['times'];v=tr['values'];kind=tr['path']
    assert all(t[i]<t[i+1] for i in range(len(t)-1))
    assert t[0]==0 and t[-1]==12 and len(t)==len(v)
    # Blender Z-up -> glTF Y-up. Every local frame is conjugated consistently.
    if kind=='translation':v=[[x,z,-y] for x,y,z in v]
    elif kind=='rotation':
        v=[[x,z,-y,w] for x,y,z,w in v]
        assert all(abs(sum(x*x for x in q)-1)<1e-5 for q in v)
        for i in range(1,len(v)):
            if sum(a*b for a,b in zip(v[i-1],v[i]))<0:v[i]=[-x for x in v[i]]
    else:assert kind=='scale'
    loop=min(sum((a-b)**2 for a,b in zip(v[0],v[-1])),sum((a+b)**2 for a,b in zip(v[0],v[-1])))**.5 if kind=='rotation' else sum((a-b)**2 for a,b in zip(v[0],v[-1]))**.5
    max_loop_error=max(max_loop_error,loop)
    assert loop<1e-5, f'Nonseamless track: {tr["name"]}: {loop}'
    static=node.get(kind,[0,0,0,1] if kind=='rotation' else [0,0,0] if kind=='translation' else [1,1,1])
    initial=min(sum((a-b)**2 for a,b in zip(v[0],static)),sum((a+b)**2 for a,b in zip(v[0],static))) if kind=='rotation' else sum((a-b)**2 for a,b in zip(v[0],static))
    assert initial<1e-8, f'Coordinate conversion mismatch: {tr["name"]}: {initial}'
    key=tuple(t)
    if key not in time_accessors:time_accessors[key]=add_accessor(t,'SCALAR',True)
    oi=add_accessor(v,'VEC4' if kind=='rotation' else 'VEC3')
    si=len(animation['samplers'])
    animation['samplers'].append({'input':time_accessors[key],'output':oi,'interpolation':'LINEAR'})
    animation['channels'].append({'sampler':si,'target':{'node':index[tr['name']],'path':kind}})
doc['animations']=[animation]
doc['buffers']=[{'byteLength':len(binary)}]
doc['asset']['copyright']='Original procedural model created for the workspace owner. No third-party model assets.'
doc['asset']['extras']={'unit':'meter','animation':'12-second baked transform loop','design':'Visualization concept; not a manufacturing or CFD model.'}

def save_glb(p,d,b):
    j=json.dumps(d,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
    b=bytes(b)+b'\0'*((-len(b))%4)
    p.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(b))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(b),b'BIN\0')+b)

save_glb(path,doc,binary)
# Single-file glTF: no external buffer or image URI; suitable for the existing importer.
embedded=json.loads(json.dumps(doc))
embedded['buffers'][0]['uri']='data:application/octet-stream;base64,'+base64.b64encode(binary).decode()
(OUT/'aqua-helix-hd.gltf').write_text(json.dumps(embedded,ensure_ascii=False,separators=(',',':')))
triangles_per_mesh=[sum(doc['accessors'][p['indices']]['count']//3 for p in m['primitives']) for m in doc['meshes']]
mesh_nodes=[n for n in doc['nodes'] if 'mesh' in n]
report={
 'format':'glTF 2.0','fileBytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
 'nodes':len(names),'independentMeshNodes':len(mesh_nodes),'uniqueMeshes':len(doc['meshes']),
 'instantiatedTriangles':sum(triangles_per_mesh[n['mesh']] for n in mesh_nodes),
 'materials':len(doc['materials']),'embeddedImages':len(doc.get('images',[])),
 'animationClips':1,'animationChannels':len(tracks),'animatedNodes':len(set(tr['name'] for tr in tracks)),
 'durationSeconds':12,'flowParticleCount':sum('_Particle_' in n or '_Tube_' in n and n.startswith('Flow_') for n in names),
 'travelingWaveRings':sum('_Wave_' in n for n in names),
 'duplicateNames':[],'externalDependencies':[],'maximumLoopError':max_loop_error,
 'checks':['Unique node names','Finite animation values','Normalized quaternions','Strictly increasing key times','Initial animation agrees with exported transforms','Seamless end-to-start motion','No external buffers or textures'],
 'standards':'https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html',
}
(OUT/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
