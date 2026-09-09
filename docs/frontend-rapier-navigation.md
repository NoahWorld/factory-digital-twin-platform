# Rapier 前端行走接入

日期：2026-09-09。状态：前端基础能力已实现，现有项目的碰撞配置编辑与保存尚未接入；后端暂缓。

## 技术选择

使用 `@dimforge/rapier3d-compat` 0.20.0。兼容包内嵌 WASM，通过动态 import 在首次进入行走时加载，避免增加运行时 CDN 或 Vite WASM 插件。每个会话独立创建/释放 World，全应用只共享 WASM 初始化。Three.js 仍负责渲染、模型动画和拾取，React 接收低频模式/错误状态；没有引入 React Three Fiber 或第二个 renderer。

代价是独立 Rapier chunk 约 2.86 MB，gzip 约 1.08 MB（本机构建值，不是网络性能承诺）。普通查看模式不请求该模块；进入行走会显示初始化状态，可取消。首次失败显示错误，不自动循环重试；网络失败后能否直接再次加载还取决于浏览器模块缓存，必要时重开页面。此处没有额外物理 Worker，复杂碰撞场景仍会占用主线程。

依据：[Rapier 官方角色控制器](https://rapier.rs/docs/user_guides/javascript/character_controller/)说明角色控制器通过碰撞查询校正移动；重力分量和最终位置更新由调用方负责。[官方 JavaScript 初始化说明](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)介绍兼容包与异步初始化。实现以锁定 0.20.0 包的类型声明和真实 WASM 测试为准。

## 数据契约与入口

类型唯一来源：`apps/web/src/scene/walk-physics.ts` 中的 `WalkSceneConfig`。它是前端调用契约，不是已存在的项目保存接口。

```ts
const walkScene: WalkSceneConfig = {
  version: 1,
  units: "meters", // 米制，Y 轴向上；必须与展示场景世界坐标一致。
  spawn: [0, 0.02, 0], // 脚底位置，地面上方 2 cm。
  yaw: 0, // 弧度；0 面向 -Z。
  bounds: { min: [-10, -2, -10], max: [10, 5, 10] },
  colliders: [
    { id: "floor", role: "floor", center: [0, -0.25, 0], halfExtents: [10, 0.25, 10] },
    { id: "wall", role: "obstacle", center: [0, 1.5, -2], halfExtents: [5, 1.5, 0.1] },
  ],
};
```

示例是测试房间，不能直接作为任何客户厂房的地面。每个碰撞体必须有唯一 ID、正的半尺寸、有限坐标；可选 `rotation` 是单位四元数 `[x,y,z,w]`。首期最多 2048 个长方体，是输入保护上限，不能视为目标硬件已验证的性能容量。

出生点胶囊不得与任何碰撞体重叠；脚下 0.2 米内最近的支撑面必须是显式 `floor`，且坡度允许通行。边界描述角色脚底的有效范围，不会生成隐形墙；走出边界立即报错并返回查看视角，不传送到猜测的地面。可见模型、拾取对象和碰撞体是三个独立集合：墙体、设备、门洞和地面需要交付人员确保对齐。系统不会根据 GLB 包围盒伪造房间，也无法仅凭这份配置证明整厂通道完整。

React 调用：给现有 `Model3DNode` 传入 `walkScene={walkScene}`、`editable={false}`、`cameraControlsEnabled={true}`，并提供正常模型节点及事件属性。提供 `walkScene` 会使用共享 SceneRuntime，包括旧单模型入口。模型成功加载后显示“进入行走”；不提供配置则不显示入口。`runtimeControlsEnabled` 控制原模型检视面板，行走入口由 `walkScene` 和相机交互权限控制。

底层接入：`await runtime.enterWalk(walkScene)` 成功返回 true，失败或取消返回 false；通过 `onNavigation` 回调和 `navigationStatus()` 区分 `loading / walk / error / orbit`。错误同时包含项目/组件上下文日志。`runtime.exitWalk()` 恢复查看视角；`dispose()` 清理相机输入与物理世界。不要忽略导航状态，仅用返回 false 判断取消。

## 行走规则与生命周期

- 使用高 1.8 m、半径 0.3 m 的运动学胶囊，相机眼高 1.6 m，目标速度 2.5 m/s。WASD/方向键移动，斜向归一化；鼠标左键拖动看向，Esc 退出。当前为桌面输入，不包含跳跃、手柄或触屏摇杆。
- 固定步长 1/60 秒，最多每帧 6 步；长帧丢弃超出补跑预算的时间并累计诊断值，避免恢复时瞬移。碰撞校正可能略微缩短实际移动距离，不能把目标速度当作现场精确测距。
- 控制器设定 1 cm 接触间隙、5 mm 法线分离增量、45° 坡度、0.25 m 自动跨阶与 0.2 m 贴地距离。分离增量用于减少米制胶囊/平面接触中的零时刻重复碰撞；这些是初始参数，楼梯、斜坡、窄门和特殊厂房仍须单独验收。
- 当前只支持静态碰撞世界：进入前关闭模型动画、整场自动旋转、拆解，外壳不能隐藏；不隐式改写项目设置。模型/实例/显示配置变化退出行走；仅选择设备变化不会退出。碰撞配置改变后调用方必须重新核对并进入，系统不会自动维护物理代理与模型的同步。
- 行走时停用 OrbitControls 的更新，角色控制器独占相机。进入前保存位置、朝向、投影与目标；进入时使用 Y-up、实际眼高和 zoom=1，退出恢复查看模式。已有整场旋转角会在行走时暂时归零，退出恢复。
- 键盘事件只属于聚焦的 canvas，不监听文档级快捷键；点击数据面板、窗口失焦、页面隐藏或离屏清空按键，避免回来后继续行走。离屏/隐藏停止场景循环，不补跑隐藏期间时间。
- WASM 初始化期间退出、切换场景或卸载后，迟到的物理世界必须释放；失败不能把普通场景加载状态冒充导航成功。每个世界只释放一次，不销毁其他视窗正在使用的世界。

## 验证与剩余工作

`pnpm test:scene-runtime` 包含真实 Rapier WASM 测试：贴地、墙体阻挡、沿墙滑动、不同帧率、斜向速度上界、补跑限制、非法参数/重叠/缺地面、越界和多世界释放。测试 runner 保留内联 source map，故障定位可使用 `NODE_OPTIONS=--enable-source-maps pnpm test:scene-runtime`。

`node scripts/test-scene-runtime-browser.mjs` 在隔离的 Chromium 中验证延迟加载、出生点失败、WASD 撞墙、失焦释放、Esc 还原相机、选择保留行走、配置变化退出和异步取消，并继续覆盖原有资源/拾取回归。浏览器工具位置见 [运行架构](./frontend-scene-runtime.md)。这些测试使用脱离后端的简化夹具。

后续仍需碰撞体制作/可视化校验、项目编辑和版本化保存、真实厂房的单位对齐、楼梯/坡道/窄门与目标硬件压测。静态简化三角网格、动态设备碰撞、移动平台、区域碰撞流式装卸和导航网格寻路尚未实现。Rapier 不解决海量模型的 draw calls、纹理显存、LOD，也不提供设备实时数据或 2D 联动的数据契约。
