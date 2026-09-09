# AQUA HELIX 内置模型

原创程序化双回路水冷机组，用于工业可视化样例。完整 GLB 随前端构建分发；Blender 源文件保留在本目录，不进入网页下载包。模型为可视化概念结构，不作为制造图纸或 CFD 结果。

## 使用入口

在项目画布添加或选中「3D 模型」，进入项目现有的 3D 编辑器，在「内置样例」点击「使用此样例」。自动设置摄影棚灯光、透明检视、左前视角和循环动画。检查面板支持外壳模式、动画启停和速度、水流显隐、组件拆解。拆解时隐藏水流，合拢后按开关恢复。节点树可搜索中文组件名及原始节点名，并继续使用项目原有的变换、材质、显隐和资产绑定功能。

这些设置随画布版本保存，在 2D 画布和运行预览中复用。切换模型会清除上一资源的节点外观与变换覆盖，避免按旧节点名称操作新模型。

## 文件与实际规格

- `source/aqua-helix-hd.blend`：可编辑源文件，含灯光、相机、材质与动画。
- `../../apps/web/public/models/aqua-helix-hd.c7f39acdb954.glb`：项目运行资源，10,912,656 字节；纹理和动画内嵌。
- `validation-report.json`：基础导出文件的几何、动画和 Blender 重新导入验证。
- `package-report.json`：加入拆解元数据后的项目文件 SHA-256 与体积。基础验证报告的哈希与此文件不同是因为新增了元数据，二进制几何、材质和动画没有改变。
- `parts-manifest.json`：零件清单。

模型包含 2,742 个独立命名节点、2,728 个网格对象（含动画粒子）、491 个复用网格、785,404 个实例化三角面及 15 种材质。动画为一个 12 秒循环片段，420 条变换通道，包含 352 个水流粒子和 32 个移动波纹环。各大组件及零件均保留层级；没有合并为单一网格。

## 再生成

从仓库根目录运行。需要 Blender 4.4（其 Python 自带 NumPy）和 Python 3。输出默认写入本目录的 `generated/`，可通过 `AQUA_OUTPUT_DIR` 指定其他位置；脚本不会更改已有源文件。

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/aqua-helix/build_model.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/aqua-helix/refine_render.py
python3 scripts/blender/aqua-helix/pack_animation.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/aqua-helix/verify_and_render.py
python3 scripts/blender/aqua-helix/package_model.py
pnpm test:models
```

构建脚本生成部件、材质、关键帧和静态 GLB；质感脚本调整灯光与材质；打包脚本将动画烘焙为标准 glTF TRS 通道并生成单文件 GLTF；验证脚本重新导入 GLB 验证运动和循环，并输出 4K 与内部特写。最后一个脚本添加 glTF Y-up 空间的拆解偏移并输出带内容哈希的 GLB。新哈希或规格变化时，应发布新的模型 ID，人工更新 `shared/builtin-models.ts`、缩略图与验证记录，保留旧版本以兼容已有项目引用。

内置元数据契约：`extras.label` 为显示名；`inspectionShell: true` 标记检视外壳；`category: "flow" | "animation"` 标记水流；`explodeOffset: [x,y,z]` 表示组件在 100% 拆解时的本地位移。缺少这些元数据的上传模型仍可使用普通节点编辑，不会伪造拆解能力。
