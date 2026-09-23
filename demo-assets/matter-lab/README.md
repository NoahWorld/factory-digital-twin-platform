# 三相流体实验舱

Kingdom 3D vision 独立 **3D 场景项目**，原创流体视觉展示。所有运动都由标准 glTF 2.0 原生动画、位置/法线 morph targets 驱动，不依赖项目专用运行时逻辑，也不修改已有行业案例。

## 展示内容

- 气体：46 组交叉密度切片，内嵌 512 × 512 程序噪声密度贴图；持续上升、扩张、翻卷并在顶端消散。是多视角软粒子烟气近似，不是体积路径追踪。
- 液体：连续起伏的透明水帘、循环水池波面、中心下凹涡流、弧形水柱和细小飞溅；使用折射、清漆层、法线贴图。
- 熔融：倾斜坩埚、连续浇注、起伏热熔池、漂浮冷却壳和飞散火星；嵌入高温色纹理，并增加透明热晕。
- 展台：拉丝钛金属、深色阳极氧化结构、耐火衬里、机械法兰/螺栓、分区铭牌及灯带。
- 背景：独立的冷暖渐变摄影棚光幕，带柔和光晕和细微纹理。它是可编辑的固定方向布景平面，不是随镜头转动的全景天空盒。

这是**预设视觉动画**，不是 CFD、真实生产采集或经验证的工程仿真。没有伪造温度、流量或实时设备状态。所有贴图均由生成器原创生成并内嵌。中文铭牌使用 macOS CoreText 将指定文案导出的矢量轮廓生成几何；只保存这组文案的轮廓，不打包系统字体，播放时不依赖本机或网络字体。

## 本地项目

- 名称：三相流体实验舱｜气体 · 液体 · 熔融（视觉演示）
- 项目 ID：`7bb746d1-862e-4d2c-a8cb-94e00fb62cf0`
- [预览](http://127.0.0.1:5173/#/projects/7bb746d1-862e-4d2c-a8cb-94e00fb62cf0/scene-preview)
- [编辑](http://127.0.0.1:5173/#/projects/7bb746d1-862e-4d2c-a8cb-94e00fb62cf0/scene)

默认关闭地面网格、开启模型动画循环；不自动转动镜头。可以拖动旋转、滚轮缩放，也可以在编辑器分别修改三种流体、展台和背景实例；背景可以独立隐藏或移动。

## 复现与更新

在仓库根执行：

```sh
node scripts/build-matter-lab.mjs
node scripts/test-matter-lab.mjs
node scripts/import-matter-lab.mjs
```

生成器输出五个自包含、带 SHA-256 文件名的 GLB 和 `manifest.json`。当前正式资源约 26.5 MiB、272,129 个三角形、341 个网格实例，共用一个 renderer；更新后的精确统计以 `manifest.json` 和 `asset-verification.json` 为准。动画周期 12 秒，三个流体实例都在该周期内无缝重复。

普通生成使用仓库内 `scripts/fluid-assets/matter-label-outlines.json` 的既有轮廓。修改铭牌文案时，先同步 `scripts/matter-lab-labels.json` 与生成器文案，再在安装了 `STHeitiSC-Medium` 的 macOS 上重新导出轮廓；缺失字体或字形会明确报错：

```sh
swift -module-cache-path /private/tmp/matter-lab-swift-cache scripts/build-matter-label-outlines.swift scripts/matter-lab-labels.json scripts/fluid-assets/matter-label-outlines.json
```

导入通过本地 Java 正式 API 完成，资源在私有对象存储、场景在项目数据库内。它只创建一个 3D 项目，不创建 2D 看板、不接入模拟指标服务、不修改客户模型或原有项目。

私有导入日志位于忽略目录 `deploy/local/.local/matter-lab-v1.json`，不包含明文凭据。再次运行会校验项目修订与资源哈希；不会重复创建。生成内容变化后须显式传入 `--update`，仅更新日志记录的本项目，更新前保存原场景快照。如项目被用户另行编辑，修订号不匹配会中止，禁止绕过该检查。

```sh
node scripts/import-matter-lab.mjs --update
node scripts/import-matter-lab.mjs --verify-only
```

结构验证覆盖 GLB 自包含、节点唯一、中文铭牌文案、512 px 贴图、背景无光照材质、48 个时间采样的有限状态、动画首尾关键帧一致、三个流体确有运动、场景资源预算。`asset-verification.json` 记录实际结果。真实浏览器另外检查了场景加载、中文显示、渐变背景、固定镜头下画面变化、单画布与无控制台错误；结构测试不冒充视觉或性能验收。

项目卡片封面由平台按已保存场景生成真实截图，不使用概念图代替。
