# 宣传页精密取放演示

公开宣传页 `#/`（兼容 `#/industrial`）的第二个交互场景，由 `PrecisionMotionDemo` 承载。展示机械臂靠近、夹紧 U 盘、抬升转运、对位放盘、松爪抬起的过程。它是模型原生动画演示，不是实时设备控制，也不代表性能承诺或客户验收记录。

## 资源与来源

- 公共资源清单：`apps/web/src/pages/precision-demo-asset.json`。
- 自包含 GLB：`apps/web/public/models/precision-pick-place.<sha256前12位>.glb`，当前约 19.04 MiB，硬预算 25 MiB。
- 提取记录：`demo-assets/precision-pick-place/provenance.json`，保留源资源哈希和节点映射。
- 原始本地离线包：仓库外 `../output/kaide/静态/dashboard-offline/js/model-data.js`。源文件、Blender 母版和客户项目均不修改。
- 原始动画截取 0–9 秒、30 Hz，共 271 帧。保留选中部件的几何、局部变换、父子关系与动画采样；不重算运动学、不生成替代轨迹。
- 为局部展示移除机罩、上层料架与其余产线，只改变保留部件的材质为钛银机身、石墨夹爪、香槟金 U 盘等。该展示是局部剖示，不是完整产线。
- 去除公开模型中的客户节点名和业务 extras。公开页面只用通用工艺名称，不含客户名称或 Logo。

## 运行约束

复用 `scene-runtime`、模型加载器与实例管理器。公开组件只允许清单中的单个资源 ID 解析至本站静态文件；不进入项目/客户资源 API，也不注册为客户项目的内置模型。进入附近区域才加载，离屏停止帧更新，卸载释放渲染与模型资源。模型加载失败显示真实错误并提供重试。

`nativePlayback` 是显式启用的会话级播放控制，支持单次（默认）与循环模式，不改变保存配置或其他场景默认的循环动画。本案例显式选择循环模式，使用原生 `LoopRepeat` 重复播放 0–9 秒片段；末尾直接从片头重新演示，不额外生成返程轨迹，也不代表连续生产物流。界面不显示进度条与秒数，保留暂停/继续、重播、四段定位与视角控制。减少动态效果偏好下不自动播放。页面主题只改变周围 UI，摄影棚和模型材质保持一致。

## 重建与验证

在仓库根目录运行：

```sh
node scripts/build-precision-demo.mjs
pnpm test:precision-demo --verify-source
pnpm test:scene-runtime
pnpm test:ui-theme
pnpm --filter @factory-twin/web check
pnpm --filter @factory-twin/web build
```

重建需要上述本地原始离线包，也可将包路径作为生成脚本第一个参数。不带 `--verify-source` 的资源校验仅依赖仓库内产物；带该参数逐一比较保留部件的全部几何和动画字节。更新资源会生成新的内容哈希文件，确认不再引用后再精确清理旧产物，禁止覆盖旧哈希内容。

浏览器验收应覆盖默认视角下的夹取与放盘、连续多轮循环、无进度条与秒数、暂停/继续、四段定位与重播、拖动/缩放/视角复位、窄屏布局、离屏暂停，以及无控制台错误。
