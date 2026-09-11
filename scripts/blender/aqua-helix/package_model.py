"""Add viewer metadata and emit a content-addressed built-in GLB.

Use after pack_animation.py. The catalog is reviewed separately; this script
never silently changes an existing model ID or removes an older asset.
"""
import hashlib
import json
import os
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(os.environ.get("AQUA_OUTPUT_DIR", str(ROOT / "demo-assets/aqua-helix-hd/generated"))).resolve()
source = OUT / "aqua-helix-hd.glb"
raw = source.read_bytes()
assert struct.unpack_from("<4sII", raw) == (b"glTF", 2, len(raw)), "Invalid GLB header"
length, kind = struct.unpack_from("<I4s", raw, 12)
assert kind == b"JSON", "Missing GLB JSON chunk"
doc = json.loads(raw[20:20 + length])
assert doc.get("animations"), "Pack the animation before packaging the model"
tail = raw[20 + length:]
offsets = {
    "01_Skid": [0, -.5, 0],
    "02_Evaporator": [0, .05, 1.4],
    "03_Condenser": [0, .05, -1.4],
    "04_Compressor": [-1, 1.35, 0],
    "05_Motor": [1.4, 1.35, 0],
    "06_Chilled_Water_Loop": [0, 0, 1.6],
    "07_Cooling_Water_Loop": [0, 0, -1.6],
    "08_Auxiliaries": [0, .9, -.3],
}
names = [node.get("name") for node in doc["nodes"]]
assert len(set(names)) == len(names) and all(names), "Node names must be unique and nonempty"
assert offsets.keys() <= set(names), "Missing an assembly required by the explosion view"
for node in doc["nodes"]:
    if node["name"] in offsets:
        node.setdefault("extras", {})["explodeOffset"] = offsets[node["name"]]
encoded = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
result = struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail)) + struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail
sha = hashlib.sha256(result).hexdigest()
filename = f"aqua-helix-hd.{sha[:12]}.glb"
destination = ROOT / "apps/web/public/models" / filename
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_bytes(result)
report = {
    "sourceSha256": hashlib.sha256(raw).hexdigest(),
    "contentPath": f"/models/{filename}", "byteSize": len(result), "sha256": sha,
    "explodableAssemblies": len(offsets),
    "changes": "Only nodes[].extras.explodeOffset added; geometry, materials and animation binary unchanged.",
}
(OUT / "package-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
print("Review shared/builtin-models.ts before using a new content hash or model version.")
