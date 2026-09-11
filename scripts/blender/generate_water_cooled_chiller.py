"""Generate an import-ready water-cooled chiller digital-twin asset.

Run with Blender 4.4 or newer:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python scripts/blender/generate_water_cooled_chiller.py

The script deliberately uses only Blender's bundled Python modules so the
asset is reproducible on a clean Blender installation.  It writes a GLB for
the platform, an editable BLEND source, and a 2560 x 1440 review render.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[2]
OUTPUT_DIR = PROJECT_ROOT / "demo-assets" / "water-cooled-chiller"
GLB_PATH = OUTPUT_DIR / "water-cooled-chiller.glb"
BLEND_PATH = OUTPUT_DIR / "water-cooled-chiller.blend"
RENDER_PATH = OUTPUT_DIR / "water-cooled-chiller-preview.png"


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block_collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


def set_input(node: bpy.types.Node, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.35,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    transmission: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    mat.metallic = metallic
    mat.roughness = roughness
    mat.use_backface_culling = False
    if color[3] < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        mat.use_transparency_overlap = False

    principled = next(
        (node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if principled is None:
        raise RuntimeError(f"Material {name} has no Principled BSDF node")
    set_input(principled, ("Base Color",), color)
    set_input(principled, ("Metallic",), metallic)
    set_input(principled, ("Roughness",), roughness)
    set_input(principled, ("Alpha",), color[3])
    set_input(principled, ("Transmission Weight", "Transmission"), transmission)
    if emission is not None:
        set_input(principled, ("Emission Color", "Emission"), emission)
        set_input(principled, ("Emission Strength",), emission_strength)
    return mat


def parent_empty(name: str, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.25
    obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def finish_mesh(
    obj: bpy.types.Object,
    name: str,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    bevel: float = 0.0,
    smooth: bool = False,
) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(mat)
    obj.parent = parent
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new(name=f"{name}_Bevel", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
    return obj


def cube(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    bevel: float = 0.04,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, name, mat, parent, bevel=bevel)


def cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    rotation: tuple[float, float, float] = (0.0, math.pi / 2.0, 0.0),
    vertices: int = 48,
    bevel: float = 0.025,
    smooth: bool = True,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat, parent, bevel=bevel, smooth=smooth)


def sphere(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    segments: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=location)
    return finish_mesh(bpy.context.object, name, mat, parent, smooth=True)


def torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    rotation: tuple[float, float, float] = (0.0, math.pi / 2.0, 0.0),
    major_segments: int = 48,
    minor_segments: int = 10,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat, parent, smooth=True)


def pipe_curve(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    resolution: int = 3,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(f"{name}_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3
    curve_data.resolution_u = 12
    spline = curve_data.splines.new(type="BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve_data)
    obj.parent = parent
    curve_data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def wire_cage(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object | None,
    *,
    vertices: int = 36,
    thickness: float = 0.012,
) -> bpy.types.Object:
    obj = cylinder(
        name,
        location,
        radius,
        depth,
        mat,
        parent,
        vertices=vertices,
        bevel=0.0,
    )
    modifier = obj.modifiers.new(name=f"{name}_Wireframe", type="WIREFRAME")
    modifier.thickness = thickness
    modifier.use_replace = True
    return obj


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "black_metal": material("MAT_BlackMetal", (0.012, 0.02, 0.035, 1), metallic=0.9, roughness=0.2),
        "dark_metal": material("MAT_DarkMetal", (0.025, 0.075, 0.13, 1), metallic=0.82, roughness=0.23),
        "steel": material("MAT_Steel", (0.28, 0.38, 0.48, 1), metallic=0.9, roughness=0.16),
        "glass_blue": material(
            "MAT_BlueGlass",
            (0.025, 0.18, 0.44, 0.18),
            metallic=0.1,
            roughness=0.08,
            transmission=0.48,
        ),
        "cyan_glow": material(
            "MAT_CyanGlow",
            (0.02, 0.55, 1.0, 1),
            metallic=0.15,
            roughness=0.18,
            emission=(0.01, 0.32, 1.0, 1),
            emission_strength=5.5,
        ),
        "cyan_soft": material(
            "MAT_CyanSoft",
            (0.03, 0.28, 0.55, 0.46),
            metallic=0.1,
            roughness=0.16,
            emission=(0.0, 0.12, 0.55, 1),
            emission_strength=1.8,
        ),
        "copper": material(
            "MAT_Copper",
            (0.95, 0.24, 0.055, 1),
            metallic=0.72,
            roughness=0.2,
            emission=(1.0, 0.08, 0.008, 1),
            emission_strength=3.4,
        ),
        "amber_glow": material(
            "MAT_AmberGlow",
            (1.0, 0.18, 0.025, 1),
            metallic=0.35,
            roughness=0.2,
            emission=(1.0, 0.055, 0.002, 1),
            emission_strength=7.0,
        ),
        "rubber": material("MAT_Rubber", (0.008, 0.012, 0.02, 1), metallic=0.05, roughness=0.55),
        "panel": material("MAT_ControlPanel", (0.045, 0.08, 0.115, 1), metallic=0.65, roughness=0.25),
        "white_light": material(
            "MAT_WhiteLight",
            (0.72, 0.9, 1.0, 1),
            roughness=0.15,
            emission=(0.45, 0.75, 1.0, 1),
            emission_strength=4.0,
        ),
        "floor": material("MAT_Floor", (0.006, 0.015, 0.03, 1), metallic=0.8, roughness=0.3),
    }


def create_base(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    group = parent_empty("GRP_BaseFrame", root)
    cube("Base_Platform", (0, 0, 0.12), (4.95, 2.15, 0.12), mats["black_metal"], group, bevel=0.12)
    for index, y in enumerate((-1.62, 1.62), start=1):
        cube(f"Base_LongRail_{index:02d}", (0, y, 0.42), (4.75, 0.16, 0.22), mats["dark_metal"], group, bevel=0.06)
    for index, x in enumerate((-3.7, -1.25, 1.25, 3.7), start=1):
        cube(f"Base_CrossRail_{index:02d}", (x, 0, 0.42), (0.15, 1.72, 0.2), mats["steel"], group, bevel=0.05)
    for index, (x, y) in enumerate(((-4.35, -1.65), (-4.35, 1.65), (4.35, -1.65), (4.35, 1.65)), start=1):
        cylinder(
            f"Base_Isolator_{index:02d}",
            (x, y, -0.04),
            0.22,
            0.24,
            mats["rubber"],
            group,
            rotation=(0, 0, 0),
            vertices=32,
        )

    cube("Digital_Floor", (0, 0, -0.18), (6.35, 3.9, 0.035), mats["floor"], group, bevel=0.03)
    for index, y in enumerate((-3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2), start=1):
        cube(f"Floor_Grid_X_{index:02d}", (0, y, -0.135), (6.15, 0.011, 0.008), mats["cyan_soft"], group, bevel=0.0)
    for index, x in enumerate((-5.6, -4.8, -4.0, -3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6), start=1):
        cube(f"Floor_Grid_Y_{index:02d}", (x, 0, -0.134), (0.011, 3.65, 0.008), mats["cyan_soft"], group, bevel=0.0)


def create_vessel(
    prefix: str,
    center: tuple[float, float, float],
    radius: float,
    length: float,
    root: bpy.types.Object,
    mats: dict[str, bpy.types.Material],
    *,
    tube_material: bpy.types.Material,
    tube_rows: int,
) -> None:
    group = parent_empty(f"GRP_{prefix}", root)
    x, y, z = center
    cylinder(f"{prefix}_GlassShell", center, radius, length, mats["glass_blue"], group, vertices=64, bevel=0.018)
    wire_cage(f"{prefix}_WireShell", center, radius * 1.012, length * 1.005, mats["cyan_soft"], group, vertices=32, thickness=0.01)
    for side_index, side in enumerate((-1, 1), start=1):
        end_x = x + side * length / 2
        cylinder(f"{prefix}_EndCap_{side_index:02d}", (end_x, y, z), radius * 1.01, 0.16, mats["dark_metal"], group, vertices=48)
        torus(f"{prefix}_EndFlange_{side_index:02d}", (end_x - side * 0.06, y, z), radius * 0.88, 0.045, mats["cyan_glow"], group)
        for bolt_index in range(12):
            angle = math.tau * bolt_index / 12
            bolt_y = y + math.cos(angle) * radius * 0.83
            bolt_z = z + math.sin(angle) * radius * 0.83
            cylinder(
                f"{prefix}_Bolt_{side_index:02d}_{bolt_index + 1:02d}",
                (end_x + side * 0.095, bolt_y, bolt_z),
                0.026,
                0.09,
                mats["steel"],
                group,
                vertices=12,
            )

    usable_radius = radius * 0.62
    tube_index = 0
    for row in range(-tube_rows, tube_rows + 1):
        for column in range(-tube_rows, tube_rows + 1):
            offset_y = column * usable_radius / max(tube_rows, 1)
            offset_z = row * usable_radius / max(tube_rows, 1)
            if offset_y * offset_y + offset_z * offset_z > usable_radius * usable_radius:
                continue
            tube_index += 1
            cylinder(
                f"{prefix}_Tube_{tube_index:03d}",
                (x, y + offset_y, z + offset_z),
                0.018,
                length * 0.91,
                tube_material,
                group,
                vertices=8,
                bevel=0.0,
            )

    for saddle_index, saddle_x in enumerate((x - length * 0.27, x + length * 0.27), start=1):
        cube(f"{prefix}_Saddle_{saddle_index:02d}", (saddle_x, y, z - radius - 0.21), (0.3, 0.48, 0.18), mats["steel"], group, bevel=0.08)


def create_motor_and_compressor(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    group = parent_empty("GRP_CompressorMotor", root)
    motor_center = (1.75, 0.12, 2.88)
    cylinder("Motor_GlassHousing", motor_center, 0.78, 3.25, mats["glass_blue"], group, vertices=64, bevel=0.025)
    wire_cage("Motor_WireHousing", motor_center, 0.79, 3.26, mats["cyan_soft"], group, vertices=36, thickness=0.012)
    for index, ring_x in enumerate([0.25 + index * 0.105 for index in range(30)], start=1):
        torus(f"Motor_CopperCoil_{index:02d}", (ring_x, 0.12, 2.88), 0.57, 0.025, mats["copper"], group, major_segments=36, minor_segments=8)

    rotor = parent_empty("Motor_Rotor", group)
    rotor.location = motor_center
    cylinder("Motor_RotorCore", (0, 0, 0), 0.22, 3.75, mats["amber_glow"], rotor, vertices=32, bevel=0.018)
    for bar_index in range(12):
        angle = math.tau * bar_index / 12
        y = math.cos(angle) * 0.39
        z = math.sin(angle) * 0.39
        cylinder(f"Motor_RotorBar_{bar_index + 1:02d}", (0, y, z), 0.033, 2.98, mats["copper"], rotor, vertices=10, bevel=0.0)

    for side_index, x in enumerate((0.08, 3.42), start=1):
        cylinder(f"Motor_EndPlate_{side_index:02d}", (x, 0.12, 2.88), 0.81, 0.18, mats["dark_metal"], group, vertices=48)
        torus(f"Motor_EndRing_{side_index:02d}", (x, 0.12, 2.88), 0.69, 0.045, mats["cyan_glow"], group)

    # A stylised centrifugal compressor with nested translucent and metallic stages.
    compressor_center = (-0.62, 0.12, 2.88)
    cylinder("Compressor_MainBody", compressor_center, 0.87, 1.18, mats["glass_blue"], group, vertices=64)
    wire_cage("Compressor_WireBody", compressor_center, 0.88, 1.19, mats["cyan_soft"], group, vertices=32, thickness=0.012)
    cylinder("Compressor_InnerStage", (-0.7, 0.12, 2.88), 0.58, 1.05, mats["dark_metal"], group, vertices=48)
    cylinder("Compressor_ImpellerHub", (-1.28, 0.12, 2.88), 0.28, 0.34, mats["amber_glow"], group, vertices=32)
    impeller = parent_empty("Compressor_Impeller", group)
    impeller.location = (-1.42, 0.12, 2.88)
    for blade_index in range(14):
        angle = math.tau * blade_index / 14
        blade = cube(
            f"Compressor_ImpellerBlade_{blade_index + 1:02d}",
            (0, math.cos(angle) * 0.42, math.sin(angle) * 0.42),
            (0.055, 0.20, 0.075),
            mats["steel"],
            impeller,
            bevel=0.025,
        )
        blade.rotation_euler.x = angle
    cylinder("Compressor_InletCone", (-1.9, 0.12, 2.88), 0.57, 0.78, mats["glass_blue"], group, vertices=48)
    torus("Compressor_InletFlange", (-2.3, 0.12, 2.88), 0.56, 0.075, mats["cyan_glow"], group)

    # Rotation animation is intentionally authored into the GLB.  The platform
    # plays every embedded clip, while its existing auto-rotate remains a
    # separate presentation control.
    rotor.rotation_mode = "XYZ"
    impeller.rotation_mode = "XYZ"
    for obj, axis in ((rotor, 0), (impeller, 0)):
        obj.rotation_euler[axis] = 0
        obj.keyframe_insert(data_path="rotation_euler", frame=1, index=axis)
        obj.rotation_euler[axis] = math.tau
        obj.keyframe_insert(data_path="rotation_euler", frame=121, index=axis)
        if obj.animation_data and obj.animation_data.action:
            for fcurve in obj.animation_data.action.fcurves:
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR"


def create_pipework(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    group = parent_empty("GRP_Pipework", root)
    pipe_curve(
        "Pipe_ChilledWater_Inlet",
        [(-5.0, 0.55, 1.05), (-4.2, 0.55, 1.05), (-3.7, 0.55, 1.55), (-3.25, 0.55, 1.55)],
        0.22,
        mats["glass_blue"],
        group,
    )
    pipe_curve(
        "Pipe_ChilledWater_Inlet_Core",
        [(-5.0, 0.55, 1.05), (-4.2, 0.55, 1.05), (-3.7, 0.55, 1.55), (-3.25, 0.55, 1.55)],
        0.07,
        mats["cyan_glow"],
        group,
    )
    pipe_curve(
        "Pipe_ChilledWater_Outlet",
        [(4.75, 0.52, 1.1), (5.2, 0.52, 1.1), (5.2, 0.52, 2.2), (4.3, 0.52, 2.2)],
        0.19,
        mats["glass_blue"],
        group,
    )
    pipe_curve(
        "Pipe_ChilledWater_Outlet_Core",
        [(4.75, 0.52, 1.1), (5.2, 0.52, 1.1), (5.2, 0.52, 2.2), (4.3, 0.52, 2.2)],
        0.06,
        mats["cyan_glow"],
        group,
    )
    pipe_curve(
        "Pipe_Refrigerant_Suction",
        [(-2.0, 0.45, 1.38), (-2.4, 0.45, 1.78), (-2.32, 0.3, 2.55), (-2.0, 0.16, 2.88)],
        0.30,
        mats["glass_blue"],
        group,
    )
    pipe_curve(
        "Pipe_Refrigerant_Suction_Core",
        [(-2.0, 0.45, 1.38), (-2.4, 0.45, 1.78), (-2.32, 0.3, 2.55), (-2.0, 0.16, 2.88)],
        0.09,
        mats["cyan_glow"],
        group,
    )
    pipe_curve(
        "Pipe_Discharge",
        [(-0.45, -0.3, 3.55), (-0.45, -1.0, 3.95), (0.25, -1.15, 3.25), (1.2, -1.1, 1.65)],
        0.16,
        mats["glass_blue"],
        group,
    )
    pipe_curve(
        "Pipe_Discharge_Core",
        [(-0.45, -0.3, 3.55), (-0.45, -1.0, 3.95), (0.25, -1.15, 3.25), (1.2, -1.1, 1.65)],
        0.045,
        mats["amber_glow"],
        group,
    )

    for flange_index, (x, y, z, radius) in enumerate(
        ((-4.85, 0.55, 1.05, 0.31), (4.82, 0.52, 1.1, 0.28), (-3.95, 0.55, 1.36, 0.31), (4.9, 0.52, 1.75, 0.28)),
        start=1,
    ):
        torus(f"Pipe_Flange_{flange_index:02d}", (x, y, z), radius, 0.055, mats["steel"], group)

    # Two hand-wheel valves create recognisable, selectable service assets.
    for valve_index, (x, y, z) in enumerate(((4.92, 0.52, 2.05), (-4.15, 0.55, 1.48)), start=1):
        cylinder(
            f"Valve_Stem_{valve_index:02d}",
            (x, y, z + 0.42),
            0.055,
            0.68,
            mats["steel"],
            group,
            rotation=(0, 0, 0),
            vertices=16,
        )
        torus(
            f"Valve_Handwheel_{valve_index:02d}",
            (x, y, z + 0.78),
            0.32,
            0.035,
            mats["cyan_glow"],
            group,
            rotation=(0, 0, 0),
            major_segments=36,
            minor_segments=8,
        )
        for spoke_index in range(4):
            angle = math.tau * spoke_index / 4
            spoke = cube(
                f"Valve_Spoke_{valve_index:02d}_{spoke_index + 1:02d}",
                (x, y, z + 0.78),
                (0.025, 0.27, 0.025),
                mats["steel"],
                group,
                bevel=0.01,
            )
            spoke.rotation_euler.z = angle

    particle_positions = [
        (-4.72 + index * 0.22, 0.55 + math.sin(index * 1.7) * 0.04, 1.05 + math.cos(index * 1.2) * 0.04)
        for index in range(15)
    ]
    particle_positions += [
        (4.97 + math.sin(index) * 0.035, 0.52 + math.cos(index * 1.3) * 0.04, 1.18 + index * 0.055)
        for index in range(13)
    ]
    for particle_index, position in enumerate(particle_positions, start=1):
        sphere(f"Coolant_Particle_{particle_index:03d}", position, 0.035, mats["white_light"], group)


def create_controls(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    group = parent_empty("GRP_Controls", root)
    cube("Control_Cabinet", (2.45, 1.15, 2.35), (1.15, 0.46, 0.82), mats["panel"], group, bevel=0.09)
    cube("Control_Cabinet_Door", (2.45, 0.675, 2.35), (1.02, 0.025, 0.69), mats["glass_blue"], group, bevel=0.035)
    cube("Control_Display", (2.38, 0.64, 2.55), (0.45, 0.018, 0.22), mats["cyan_glow"], group, bevel=0.035)
    for index, x in enumerate((1.87, 2.07, 2.27, 2.47), start=1):
        sphere(f"Control_StatusLamp_{index:02d}", (x, 0.61, 2.03), 0.055, mats["amber_glow"] if index == 4 else mats["cyan_glow"], group)
    cube("Control_DoorHandle", (3.18, 0.62, 2.33), (0.035, 0.035, 0.25), mats["steel"], group, bevel=0.02)

    for support_index, x in enumerate((-2.2, 2.1), start=1):
        cube(f"Upper_Support_{support_index:02d}", (x, 0.12, 2.0), (0.26, 0.55, 0.18), mats["steel"], group, bevel=0.07)


def create_scene_lighting(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.0015, 0.003, 0.009, 1)
    background.inputs["Strength"].default_value = 0.09

    def area(name: str, location: tuple[float, float, float], color: tuple[float, float, float], energy: float, size: float) -> bpy.types.Object:
        light_data = bpy.data.lights.new(name=f"{name}_Data", type="AREA")
        light_data.energy = energy
        light_data.color = color
        light_data.shape = "DISK"
        light_data.size = size
        obj = bpy.data.objects.new(name, light_data)
        obj.location = location
        bpy.context.collection.objects.link(obj)
        point_camera(obj, (0, 0, 1.7))
        return obj

    area("Render_KeyLight", (-2.5, -5.0, 7.5), (0.18, 0.48, 1.0), 1500, 5.0)
    area("Render_RimLight", (4.5, 2.5, 5.5), (0.02, 0.32, 1.0), 1250, 4.0)
    area("Render_WarmLight", (0.5, -1.5, 5.0), (1.0, 0.16, 0.025), 900, 2.5)
    area("Render_FillLight", (-5.0, 3.0, 2.8), (0.08, 0.38, 0.75), 850, 3.0)

    camera_data = bpy.data.cameras.new("Render_Camera_Data")
    camera = bpy.data.objects.new("Render_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (11.7, -13.4, 8.0)
    camera_data.lens = 55
    camera_data.sensor_width = 36
    point_camera(camera, (0, 0, 1.65))
    bpy.context.scene.camera = camera
    return camera


def point_camera(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def configure_render() -> None:
    scene = bpy.context.scene
    bpy.context.preferences.filepaths.save_version = 0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 2560
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.filepath = str(RENDER_PATH)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.color_mode = "RGB"
    scene.frame_start = 1
    scene.frame_end = 121
    scene.frame_set(32)

    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    render_layers = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.65
    glare.size = 7
    composite = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], composite.inputs["Image"])


def export_outputs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(RENDER_PATH)
    bpy.ops.render.render(write_still=True)

    # Keep the editable source after the render scene is fully assembled.
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    # Camera and render-only lights are excluded from the runtime asset.
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        export_apply=True,
        export_animations=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        # This asset has no normal maps, so tangents would add bytes and cause
        # Blender to warn on the intentionally low-sided tube end caps.
        export_tangents=False,
        export_attributes=True,
    )


def main() -> None:
    clean_scene()
    mats = create_materials()
    root = parent_empty("WaterCooledChiller_ROOT")
    create_base(root, mats)
    create_vessel(
        "Evaporator",
        (0.0, 0.55, 1.18),
        0.72,
        7.4,
        root,
        mats,
        tube_material=mats["cyan_glow"],
        tube_rows=4,
    )
    create_vessel(
        "Condenser",
        (0.15, -0.93, 1.08),
        0.66,
        7.65,
        root,
        mats,
        tube_material=mats["copper"],
        tube_rows=4,
    )
    create_motor_and_compressor(root, mats)
    create_pipework(root, mats)
    create_controls(root, mats)
    create_scene_lighting(mats)
    configure_render()
    export_outputs()
    missing_outputs = [
        str(path)
        for path in (GLB_PATH, BLEND_PATH, RENDER_PATH)
        if not path.is_file() or path.stat().st_size == 0
    ]
    if missing_outputs:
        raise RuntimeError(f"Generation finished without required outputs: {missing_outputs}")
    print(f"Generated GLB: {GLB_PATH}")
    print(f"Generated BLEND: {BLEND_PATH}")
    print(f"Generated preview: {RENDER_PATH}")


if __name__ == "__main__":
    main()
