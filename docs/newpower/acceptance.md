# NewPower 实际验收

## M0（2026-09-12）

起点：`bdf3905997f1a9301b97445a2917622b3430dc6b`。本机 Node 24.18.0、pnpm 10.0.0、Chrome，由 Playwright 1.62.0 操作；视口 1440 × 1000。

| 检查 | 实际结果 |
| --- | --- |
| 工作区导入与分支 | 当前目录空目录克隆 `newpower`，导入检查 0 问题 |
| 锁文件安装 | 通过；增加 Playwright 用于本轮浏览器回归，原应用依赖版本保持 |
| `pnpm build` | 修复首次并行顺序后通过；API 为 dry-run，未部署 |
| `pnpm check` | web/API TypeScript 均通过 |
| 本地迁移 | 独立测试库应用 0001–0011 全部通过 |
| API smoke | 12 项通过，涵盖认证、GLTF 上传、字段发现、标准化数据、陈旧与故障恢复 |
| 浏览器基线 | 2 项通过：登录→创建→模板→保存重开；模型渲染/点击→指标→陈旧→失联→自动恢复 |

证据目录为 `/Users/inosaki/Documents/Codex/local/runtime/newpower-01a095a6/`：`m0-build.log`、`m0-migrations.log`、`m0-smoke.log`、`m0-browser.log` 和 `m0-browser/` 截图。模型为 smoke 生成的自包含模拟立方体，不代表公司模型或性能量测。

实际服务：前端 `http://127.0.0.1:5173` 代理至隔离 Worker `http://127.0.0.1:8791`；mock 为 `http://127.0.0.1:8790`。测试 Worker 配置与状态分别位于该证据目录的 `test/wrangler.jsonc`、`test/state/`；测试会话与临时凭据仅在权限 0600 的 `session.json`，不提交。

浏览器复验：设置 `NEWPOWER_SESSION_FILE` 指向该私有会话文件，运行 `pnpm exec playwright test tests/baseline.spec.ts`。服务须已启动，默认连接本机 5173；可用 `NEWPOWER_BASE_URL` 和 `NEWPOWER_MOCK_URL` 指向同一隔离环境。

M1 尚未验收；当前证据不表示纯二维通用绑定已具备。大模型、多设备规模及真实公司接口仍待后续目标环境验证。
