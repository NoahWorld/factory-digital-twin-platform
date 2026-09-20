# Cloudflare 到本地迁移记录

## 结果

2026-09-18 已把 Cloudflare D1 `factory-digital-twin-config` 的业务快照，以及仓库中旧 Wrangler 本地状态内遗留的 3D 工厂项目和 R2 对象，导入本地 Java/PostgreSQL + SeaweedFS 环境。Cloudflare 源数据和旧 Wrangler 状态只读访问，未删除或修改。

迁移前先创建并验证了 PostgreSQL、SeaweedFS 对象数据和本地凭据备份：

```text
deploy/local/.local/backups/2026-09-18T01-56-21.115Z
deploy/local/.local/backups/2026-09-18T02-20-22.600Z
```

备份、D1 导出、SQLite 中间库、导入 SQL、验收脚本和带 SHA-256 的清单均位于 Git 忽略的 `deploy/local/.local/`，不得提交或对外发送。

## 源数据盘点

| 数据 | Cloudflare 快照数量 | 本地结果 |
| --- | ---: | --- |
| 项目 | 1 | 已导入，保留原 ID、名称、状态和时间戳 |
| 2D 画布 | 1 | 已导入，保留 1920 × 1080、修订号 4 和主题 |
| 画布节点 | 0 | 无记录可迁移 |
| 项目版本 | 0 | 无记录可迁移 |
| 用户上传模型 | 0 | 无记录可迁移 |
| 资产 | 0 | 无记录可迁移 |
| 数据源 | 0 | 无记录可迁移 |
| 数据绑定 | 0 | 无记录可迁移 |

迁入项目为 `测试项目`，项目 ID `5af73950-c788-4ae1-970e-79ef061ef79f`。它被映射为本地租户下的 2D 项目，并由本地管理员持有 `owner` 权限。

Cloudflare 账号在核对时尚未启用 R2，D1 的 `model_assets` 也为空，因此没有用户上传对象可下载。固定白名单内的示例模型和案例模板原本就是仓库静态资源：本地验收确认 36 个内置模型和 8 套画布模板均可随前端构建，不依赖 R2。

## 旧 Wrangler 本地状态补迁

云端 D1 只有一个空画布项目，但 `apps/api/.wrangler/state/v3/` 中仍保存着此前本地 Worker 创建的 3D 工厂、组合大屏和上传资源。补迁脚本 [import-wrangler-local.mjs](../scripts/import-wrangler-local.mjs) 会先定位含有效数据的 D1/R2 SQLite 文件，为两份库和对象文件创建带 SHA-256 的 Git 忽略快照，再生成导入 SQL。写入使用单个 PostgreSQL 事务；本地管理员缺失、任一项目 ID 冲突、对象大小或哈希不一致都会直接失败。

```bash
pnpm backend:backup
pnpm backend:recover:wrangler:prepare
pnpm backend:recover:wrangler:apply
pnpm backend:recover:wrangler:verify
```

本次补迁结果：

| 数据 | 数量 |
| --- | ---: |
| 项目 / 画布或场景文档 | 6 / 6 |
| 2D 画布节点 | 31 |
| 3D 场景实例 | 196 |
| 模型与图片资源 | 6 |
| 资产 / 数据源 / 数据绑定 | 8 / 1 / 47 |

恢复的项目包括 `示例生产车间 · 机械臂与 AGV`（98 个实例）、`智能车间 2D+3D 联动 Demo · 模拟数据`（98 个实例）、`长沙凯德 · 金属质感设备`，以及三个既有 2D 项目。6 个 R2 对象包含 4 个 GLB 和 2 张 JPEG，迁入 SeaweedFS 后逐个回读并核对 SHA-256。旧项目所有权映射给本地管理员；旧账号、密码和会话仍不迁移。每个项目都在 `audit_events` 中记录 `migration.wrangler-local.import`。

## 身份边界

旧 Worker 的用户、密码散列、角色和会话没有导入。Java 后端继续使用本地管理员及更严格的密码规则，避免把旧验证环境的身份材料带入独立部署。导入操作在 `audit_events` 中记录为 `migration.cloudflare.import`。

## 验收

- 两次迁移前备份均完成数据库、对象存储和凭据快照；第一次备份还在一次性 PostgreSQL 中恢复验证，包含 15 张表、1 个用户和 0 个项目。
- 云端快照和 Wrangler 补迁都使用单个 PostgreSQL 事务，并在本地管理员缺失或项目 ID 冲突时直接失败。
- 数据库对账确认补迁的 6 个项目、6 份文档、227 条文档项、6 个资源、8 个资产、1 个数据源和 47 条数据绑定与源快照一致。
- 真实 Java API 登录后可列出全部 7 个项目；`示例生产车间 · 机械臂与 AGV` 返回修订号 5 和 98 个实例，联动 Demo 返回 98 个实例并正确关联 15 节点的 2D 看板。
- Java API 可列出补迁的 4 个 GLB 和 2 张图片；签名下载回读的模型与源 SHA-256 一致。
- `pnpm test:models` 通过内置 GLB 哈希、动画、资源与契约校验。
- `pnpm test:standalone-3d` 通过 98 实例车间目录、预算和场景迁移校验。
- `pnpm --filter @factory-twin/web build` 通过。
- 浏览器确认默认首页渲染公开 3D 工厂，恢复后的生产车间预览也成功渲染且控制台无错误；本地前端 `http://127.0.0.1:5173` 与后端 `/health` 均返回 200。

如需回滚本次业务导入，先停止写请求，再使用上述已验证备份按 [Java 后端说明](../apps/backend/README.md) 的恢复流程恢复数据库和对象存储。不要只删除项目行后宣称完成回滚，因为审计、对象和本地凭据需要保持同一备份时间点。
