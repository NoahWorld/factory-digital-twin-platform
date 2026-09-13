# NewPower 本地运行宿主

Node.js 24.18+（24 系列），复用现有 API、项目 schema、权限和模型检查。SQLite 保存配置，本地文件存储实现原有 ObjectBucket 接口；静态前端和 API 同源服务。当前阶段仍是按请求 REST 采集，集中采集在 M6a 后续接入，不能按宿主启动状态认定已完成。

在仓库根目录执行 `pnpm build`，产物位于 `apps/runtime/dist`。该目录包含服务器、迁移和前端，可以复制到独立目录；运行时仅需匹配版本的 Node，不依赖 Vite、Wrangler、源码目录或 node_modules。完整发布/项目打包与回滚仍归 M5。

```sh
node server.mjs --data-dir ./data --config ./runtime.env --port 8792
```

默认仅监听 `127.0.0.1`。`runtime.env` 参考本目录的 `.env.example`，与项目配置/资源包分离。首次初始化需提供自选 `BOOTSTRAP_TOKEN`，没有默认账户或密码；已有账户无需再次初始化。白名单使用精确 `host:port`，本地 mock 为 `127.0.0.1:8790`。

配置库迁移沿用 `apps/api/migrations`，产物携带对应 SQL 和校验历史。初次创建新库；后续有迁移时先在线备份并检查完整性，成功后才执行事务。未知/漂移的迁移历史、失败备份、SQL错误或外键问题均阻止升级。不会自动重置或重放未跟踪的旧数据库；现有 Worker 验收库继续保留。

SQLite 批次使用原子事务、准确 changes 和外键。当前 Node 24.18 尚没有 StatementSync.close，适配器限制保留的预编译语句数量，并在关闭时释放数据库连接。SQLite 原生模块在 Node 24 文档中标为 release candidate，当前方法均以本机 24.18 实测为准，未直接照用较新文档新增接口。参考[Node 24 官方 SQLite 文档](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md)。
