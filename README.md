# 工厂数字孪生交付平台

面向交付人员的工厂数字孪生项目生成器，用行业模板、标准 glTF 2.x 模型、资产台账与统一数据契约，快速交付 **2D + 3D 组合大屏**。

## 当前结构

```text
apps/
  web/       React + Vite 的配置台与运行态前端
  api/       Cloudflare Worker API，绑定 D1 项目配置库
```

当前 Cloudflare 资源：

- Worker：`factory-digital-twin-api`
- D1：`factory-digital-twin-config`
- D1 UUID：`69d2f423-b115-4dfc-b347-41d70f214c67`
- R2 绑定：`MODEL_ASSETS` → `factory-digital-twin-model-assets`（本地可直接模拟；远程桶尚未创建）

## 已实现的第一期基础能力

- 用户身份：首个平台管理员初始化、邮箱密码登录、服务端会话 Cookie 与退出登录。
- 权限边界：平台管理员、交付负责人、只读用户三个全局角色；项目内另有负责人、可编辑、只读成员关系。
- 项目：受权限保护的项目列表与新建草稿项目；创建人自动成为项目负责人。
- 2D 画布：固定 1920 × 1080 交付画布，支持折线图、柱状图、矩形、圆形，以及大屏标题、背景点缀、时间日期、标题、小卡片背景和小图标背景从组件面板拖入；组件移动时自动吸附并显示辅助线，选中后可从四角自适应缩放并配置内容、颜色和静态数据，保存后可进入只读预览。
- 3D 组件：从组件面板拖入 3D 模型视窗后，通过画布右侧摘要进入独立 3D 编辑页。独立页提供大视口与完整属性面板，可导入 GLB 或自包含 GLTF，支持模型对象点击、节点树双向选择、临时包围框高亮、镜头旋转/缩放，以及节点位置、旋转、缩放、材质颜色、透明度、显隐、背景、灯光、网格、视角和自动旋转配置。“保存并返回”增量写回同一个画布节点，不维护第二份 3D 数据。服务端检查格式、版本、文件体积、节点/网格/材质/纹理/动画数量与重复节点名；模型资源写入 R2，画布只保存资源 ID。
- 资产台账与模型映射：项目内维护稳定业务编号 `assetId`，可将唯一命名的模型节点新建并绑定到资产，也可绑定已有未映射资产；支持修改资产信息和解除节点绑定，解绑不会删除资产台账记录。重复 `assetId`、重复模型节点及未知字段由服务端明确拒绝。
- 数据源配置：画布工具栏可打开项目级数据源面板，创建和修改 REST 轮询或 WebSocket 连接元数据。REST 配置保存轮询周期与请求超时，WebSocket 配置保存心跳与最大重连间隔；明文账号、密码、Token 和 API Key 不进入 URL 或前端配置，只允许引用服务端凭据。当前节点只完成配置契约，尚未宣称连接已运行。
- 资产指标映射：在独立 3D 编辑器中为已绑定资产配置项目数据源、唯一指标键、JSON 字段路径、值类型、单位与数据过期时间。映射独立按行保存，不进入画布 JSON；当前节点只完成配置和校验，实时采集仍待后续执行器接入。
- 画布存储：画布元数据与组件节点分表保存，移动单个组件只提交增量节点；资源和实时数据不写入大 JSON，只保留资源与数据绑定引用。
- 可迁移性：用户、角色、会话和项目成员均为应用自身的 D1 schema 与 API 契约，不依赖 Cloudflare 登录产品；后续可迁移到 Node.js + PostgreSQL。

当前未做用户管理界面和项目成员分配页面；它们是下一阶段配置台功能，不以公开注册替代权限管理。

## 本地启动

安装依赖后，先准备本地 Worker 的初始化令牌。此令牌只用来创建**唯一的首个管理员**，绝不能提交到 Git：

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

修改 `apps/api/.dev.vars` 中的 `BOOTSTRAP_TOKEN` 为足够长的随机值，再在仓库根目录执行：

```bash
pnpm install
pnpm --filter @factory-twin/api db:migrate:local
pnpm dev:api
```

在另一个终端启动前端：

```bash
pnpm dev:web
```

打开 `http://localhost:5173`，首次访问会显示“初始化平台管理员”页面。输入 `.dev.vars` 中的初始化令牌后创建管理员；之后只能通过登录进入项目列表。

本地前端通过 Vite 代理以同源方式访问 `/api`，从而能正确使用 HttpOnly 会话 Cookie。正式部署也应让前端与 API 位于同一站点或经同一反向代理暴露；不要把 `workers.dev` 域名写进组件代码。

如需在单独的同源 API 网关下运行，可在 `apps/web/.env.local` 设置 API 基地址：

```dotenv
VITE_API_BASE_URL=/
```

## 验证

```bash
pnpm check
pnpm build
```

本地数据库迁移包括 `0001_initial.sql`（项目、资产与数据配置）、`0002_access_control.sql`（用户、角色、会话与项目成员）、`0003_canvas_foundation.sql`（画布元数据与组件节点）、`0004_canvas_shape_nodes.sql`（基础图形）、`0005_canvas_decoration_nodes.sql`（大屏点缀组件）和 `0006_model_assets_and_3d_node.sql`（模型资源与 3D 组件）。云端 D1 尚未执行这些业务迁移。远程部署前先创建 R2 桶：

```bash
npx wrangler r2 bucket create factory-digital-twin-model-assets
```

然后显式运行迁移：

```bash
pnpm --filter @factory-twin/api db:migrate:remote
```

然后在 Cloudflare Worker 的受控密钥配置中设置 `BOOTSTRAP_TOKEN`，再部署 API。不要创建默认账号，也不要在源码、迁移或前端中写入任何密码或真实令牌。

产品范围、数据约束与开发规则见 [AGENTS.md](./AGENTS.md) 和 [启动准备方案](./工厂数字孪生平台-启动准备与首期方案.md)。
