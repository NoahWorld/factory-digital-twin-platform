# 工厂数字孪生交付平台

面向交付人员的工厂数字孪生项目生成器，用行业模板、标准 GLB、资产台账与统一数据契约，快速交付 **2D + 3D 组合大屏**。

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

## 已实现的第一期基础能力

- 用户身份：首个平台管理员初始化、邮箱密码登录、服务端会话 Cookie 与退出登录。
- 权限边界：平台管理员、交付负责人、只读用户三个全局角色；项目内另有负责人、可编辑、只读成员关系。
- 项目：受权限保护的项目列表与新建草稿项目；创建人自动成为项目负责人。
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

本地数据库迁移包括 `0001_initial.sql`（项目、资产与数据配置）和 `0002_access_control.sql`（用户、角色、会话与项目成员）。云端 D1 尚未执行这两份业务迁移，部署前必须显式运行：

```bash
pnpm --filter @factory-twin/api db:migrate:remote
```

然后在 Cloudflare Worker 的受控密钥配置中设置 `BOOTSTRAP_TOKEN`，再部署 API。不要创建默认账号，也不要在源码、迁移或前端中写入任何密码或真实令牌。

产品范围、数据约束与开发规则见 [AGENTS.md](./AGENTS.md) 和 [启动准备方案](./工厂数字孪生平台-启动准备与首期方案.md)。
