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

## 本地启动

安装依赖后，在仓库根目录执行：

```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

前端默认访问 `http://localhost:8787`。如 API 地址不同，在 `apps/web/.env.local` 设置：

```dotenv
VITE_API_BASE_URL=http://localhost:8787
```

## 验证

```bash
pnpm check
pnpm build
```

目前 Worker 只提供 `GET /health`。D1 初始表结构已写入 `apps/api/migrations/0001_initial.sql`，尚未应用到云端数据库；在开始项目配置 API 前，必须通过 Wrangler 执行迁移并验证结果。

产品范围、数据约束与开发规则见 [AGENTS.md](./AGENTS.md) 和 [启动准备方案](./工厂数字孪生平台-启动准备与首期方案.md)。
