# 水冷机组 3D 演示资产

这套资产由 `scripts/blender/generate_water_cooled_chiller.py` 程序化生成，视觉方向是透明蓝色数字孪生机壳、铜色发光电机绕组与可识别的水路/冷媒管路。它是虚构演示资产，不代表真实客户设备或工程尺寸。

生成命令：

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/generate_water_cooled_chiller.py
```

输出：

- `water-cooled-chiller.glb`：平台导入文件，节点名稳定且唯一。
- `water-cooled-chiller.blend`：可继续修改的 Blender 源文件。
- `water-cooled-chiller-preview.png`：2560 × 1440 视觉验收图。

建议在平台 3D 场景中使用深黑蓝背景、等轴视角、38°–45° FOV，并关闭整机自动旋转后观察模型自带的电机/叶轮动画。实际资产映射只绑定需要参与数据联动的设备级节点，例如 `Motor_Rotor`、`Compressor_Impeller`、`Valve_Handwheel_01`，无需绑定装饰性粒子或网格节点。
