# DTwin · IoT 三维前端

`iot-3d` 从 `main` 的 `61c71a1` 创建，用现有 DTwin 三维编辑与渲染能力承载产线数字孪生。前端独立构建、挂载到 IoT 同源 `/twin/`；登录、权限、项目和资源服务由 IoT 提供，文件存储使用 IoT MinIO。

**当前状态：前端适配已完成，IoT 孪生业务接口尚待实现和联调。** 未接入时会显示缺少权限或接口，不会退回独立 DTwin 后端或模拟成功。此分支不提供独立登录、用户管理或匿名分享。

## 开发

本仓库已使用 Node 24.0.2、pnpm 10.0.0 验证。IoT 前端继续使用自己的 Node 16 / npm 8，无需升级。

```bash
pnpm install --frozen-lockfile
pnpm dev:web
```

DTwin 在 `127.0.0.1:5173` 启动。另按 IoT 项目自身说明启动前后端，从已登录的 IoT 站点打开 `/twin/`，例如 `http://localhost:8000/twin/`。IoT 开发代理需将 `/twin` 原样转发到 5173，`/cloud` 继续转发到 IoT 后端 18848。

必须使用与 IoT 登录相同的协议、主机和端口；直接访问 5173 不共享 8000 的登录态。DTwin 只读取现有 `x-access-token`，通过 `/authorize/me` 校验权限，不创建自己的账号或会话。

可选环境配置见 [apps/web/.env.example](apps/web/.env.example)，复制到 `apps/web/.env.local` 后按现场填写。开发 API 默认 `/cloud`，生产默认 `/cloudPro/api`；MinIO 的浏览器访问来源需显式配置。不得向 `VITE_*` 写入 MinIO 密钥或登录令牌。

## 构建与验证

```bash
pnpm check
pnpm build
pnpm test:iot-integration
pnpm test:api-errors
pnpm test:project-covers
pnpm test:scene-runtime
pnpm test:twin-drive
pnpm test:uuid
```

构建只生成 `apps/web/dist`。`pnpm test:iot-integration:browser` 使用 Playwright 和隔离接口数据验证页面；可通过 `PLAYWRIGHT_MODULE_PATH` / `CHROMIUM_EXECUTABLE` 指定已有测试运行环境。它不会访问真实 IoT/MinIO，也不能替代现场联调。

## 当前范围

- 保留三维编辑器、内置模型、场景搭建、模板、项目封面、2D 看板与详情联动，默认进入 3D 项目。
- 全部业务请求交给 IoT，私有资源先授权再获取短期下载地址；WebSocket 消费 IoT 签发的单次项目票据。
- 原独立后端的 AI/BIM 转换、模型压缩、测试业务模板和匿名分享入口已撤下。
- IoT 仍需实现孪生权限、项目/场景、资源元数据与 MinIO 接口，以及设备属性、报警和订阅映射；目前未完成真实产线的数据接通。

接口约定、同源部署、MinIO 与下一步验收见 [IoT 接入说明](docs/iot-integration.md)。长期规则见 [AGENTS.md](AGENTS.md)，产品方向见 [实施方案](工厂数字孪生平台-启动准备与首期方案.md)。

`apps/api`、`apps/backend` 与旧部署脚本仅保留历史参考，已不属于本分支的运行流程；独立产品原说明见 [历史归档](docs/legacy-standalone-readme.md)。原独立后端仓库及其数据未改动。
