# Cloudflare 临时部署与迁移约定

## 当前已验证资源

| 项目 | 值 | 状态 |
| --- | --- | --- |
| 临时 API 运行环境 | Cloudflare Workers 免费计划 | 已创建并公网验证 |
| Worker 名称 | `factory-digital-twin-api` | 已创建 |
| 临时访问地址 | `https://factory-digital-twin-api.resetshi.workers.dev/` | 已返回 HTTP 200 |
| 当前代码 | Vite 产品页、配置台与 Worker 业务 API | 已同域发布；公网浏览器渲染与深层 SPA 路由已验证 |
| 自定义域名 | 未绑定 | 暂不需要 |
| API Token / 密钥 | 未创建 | 暂不需要 |
| `BOOTSTRAP_TOKEN` | 已于 2026-07-30 设置 | 值只保存在 Worker 受控密钥中，不写入仓库；用于创建唯一的首个管理员 |
| R2 模型文件桶 | 本地可模拟，远程账号尚未启用 R2 订阅 | 远程暂不声明 `MODEL_ASSETS`；模型接口明确返回 503 |
| D1 配置数据库 | `factory-digital-twin-config` | 已创建；UUID 为 `69d2f423-b115-4dfc-b347-41d70f214c67`；0001–0008 已于 2026-07-30 全部应用 |

Cloudflare Workers 在这里充当临时的无服务器 API 入口，不等同于一台传统服务器。当前部署由同一 Worker 域名提供 Vite 静态前端和 `/api`，保持登录 Cookie 同源。它适合先验证项目配置、数据网关和小流量展示接口；客户内网数据采集、持久化大数据、模型重处理等能力仍需后续服务器或客户现场部署承载。

## 当前阶段不创建的资源

- 不创建 Cloudflare API Token、Access Token、OAuth 凭证或服务密钥。
- 不上传真实工厂模型、客户数据、接口样本或证书。
- 不绑定正式域名，不设置生产路由，不接入支付项目。
- R2 已被 3D 组件原型明确使用；启用 R2 需要在 Cloudflare 完成订阅结账流程，因此未得到明确计费授权前不代替用户开通。远程未绑定期间，健康检查标为 `degraded`，模型接口明确返回 `503 model_storage_not_configured`，不得改存 D1 或伪装成功。KV、Queues、Durable Objects 等其余资源仍不提前创建。

这样可以保持免费试验环境最小化，也避免把尚未确定的产品架构锁死在某个云厂商服务上。

## 首个原型需要接入的内容

P1 原型的 Worker 配置和 D1 迁移已纳入 `apps/api/`，云端数据库已经执行 0001–0008。后续只通过仓库中的迁移脚本变更 schema，不在 Cloudflare 控制台中手工维护代码或表结构。当前最小接口为：

| 接口 | 用途 | 备注 |
| --- | --- | --- |
| `GET /health` | 部署、监控与迁移后的存活检查 | 返回版本、时间与依赖状态；不得返回密钥 |
| `GET /api/v1/auth/bootstrap-status` | 判断是否需要首个管理员初始化 | 不返回用户信息或令牌 |
| `POST /api/v1/auth/bootstrap` | 创建唯一首个管理员并建立会话 | 仅 users 为空且请求携带服务端 `BOOTSTRAP_TOKEN` 时允许 |
| `POST /api/v1/auth/login` / `logout` | 登录、退出与 HttpOnly 会话 | 不设置默认账号或公开注册 |
| `GET` / `POST /api/v1/projects` | 按角色与项目成员关系读取/新建项目 | 项目创建需要平台管理员或交付负责人 |
| `GET` / `POST /api/v1/projects/:id/assets` | 读取资产台账、新建资产并可绑定模型节点 | `assetId` 与 `modelNode` 均做项目内冲突校验 |
| `PATCH /api/v1/projects/:id/assets/:recordId` | 修改资产信息、绑定或解除模型节点 | 解除绑定保留资产台账记录；修改需要项目编辑权限 |
| `GET` / `POST /api/v1/projects/:id/data-sources` | 读取或新建 REST/WebSocket 连接配置 | 只保存连接元数据与服务端凭据引用，不保存明文凭据 |
| `PATCH /api/v1/projects/:id/data-sources/:sourceId` | 修改项目数据源配置 | 当前不代表连接已启用；连接测试和运行状态由后续采集执行器提供 |
| `GET /api/v1/projects/:id` | 下发已发布项目配置 | 配置由版本化 schema 生成 |
| `GET /api/v1/assets/:assetId/state` | REST 轮询状态样例 | 返回统一 `assetId/timestamp/values` 结构 |
| `GET /api/v1/events` 或 WebSocket 路由 | 实时状态入口 | 先定义事件契约后接入 |

第一版 Worker 只负责 API 入口、鉴权、参数校验、标准化和可观测日志。它不直接保存客户密钥到前端，也不直连 PLC/OPC UA/MQTT；客户内网数据仍通过可部署的数据网关/采集器进入。

## 为未来迁移保留的边界

1. 前端只读取 `PUBLIC_API_BASE_URL`，不把 `workers.dev` 域名写死在组件中。
2. 后端路由、数据 schema、认证和错误格式必须与运行平台无关；Cloudflare Worker 和后续 Docker/Node 服务都实现同一 API 契约。
3. 数据访问通过 repository/adapter 层。若以后使用 D1、PostgreSQL 或客户数据库，只替换适配器和迁移脚本。
4. 模型文件通过对象存储抽象访问。Cloudflare 验证环境启用模型存储时使用 R2；当前 R2 未开通，接口明确降级。现场部署保持资源 ID、对象键与元数据契约，存储适配器替换为 MinIO/S3，禁止让画布节点依赖 R2 URL。
5. WebSocket/SSE 消息统一为 `assetId + timestamp + values`；不可让前端依赖 Cloudflare 专属消息对象。
6. 所有配置、数据库表和对象路径必须可导出，迁移要以脚本和版本化 schema 完成，不依赖控制台手工状态。

## 上线前再决定的事项

- 是否继续使用 Cloudflare Workers，或迁移为 Docker 化 API 服务。
- 模型资源的实际容量、地域、访问控制和 CDN 策略。
- D1 是否适合项目配置与轻量元数据；历史时序数据默认不以 D1 为目标。
- 正式域名、TLS 证书、客户内网连通方式、日志保留和备份策略。
- Cloudflare 免费计划是否仍满足当期配额与商业交付要求；上线前必须按官方当前配额重新核验。
