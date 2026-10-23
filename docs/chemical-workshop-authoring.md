# 化工车间与原生组合看板复用

公共生成器使用项目现有 Three.js 输出米制、Y-up 的自包含 GLB，不依赖 IoT、网络模型服务或 Blender。

- `node scripts/generate-chemical-equipment.mjs`：反应釜、清洗釜、卧式固液分离器与分散机结构示意。
- `node scripts/generate-separation-line-pipes.mjs`：七设备布局的管道模型和布局 JSON，生成前先运行设备生成器。
- `node scripts/generate-chemical-workshop.mjs`：通用管廊、集液区、平台与仪表柜背景；更新内置资源时必须同步 `shared/chemical-workshop-model.ts`、公开 GLB/缩略图和独立 Java 后端生成契约。
- `node scripts/generate-silver-workshop.mjs`：立式分离器在内的硝酸银设备、示意搅拌动画及详细车间；见 [组装示例](../demo-assets/silver-nitrate-workshop/README.md)。

两类分离器属于不同的示意模型，不自动替换客户设备。生成文件必须通过资源库上传并取得当前后端的资源 ID；生成脚本不会创建项目、修改数据库或下发现场命令。设备尺寸、隐藏结构、接口与工艺路径需按现场资料核对。

批量 3D 视窗可接收可信前端传入的可选 `cameraFraming={direction,targetOffset}`，用于展示镜头。它不会写入文档或改变 API 契约；省略时保持原有镜头行为，方向必须非零且所有数值有限。

复用范围仅包含公共建模、原生组件组装及展示运行层。`main` 保持独立鉴权、项目权限、资源解析、模板中心和 Java 后端；IoT 会话入口及专用 dashboard 存量接口不随这些工具迁入。
