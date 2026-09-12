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

M0 只证明旧链路；新增能力见下方 M1 实际验收。

## M1（2026-09-12）

新增本地迁移 `0012_component_data_bindings.sql` 已成功应用。绑定定义独立存储，引用、组件目标、指标类型、归属与整个画布版本共同校验；失败保存不改变现有版本。标准化指标保留 `null`，运行快照和设备选择不修改静态 props。

| 验收场景 | 实际结果 |
| --- | --- |
| 纯二维界面配置 | 在属性面板为固定指标卡、当前设备指标卡、柱状图和表格配置绑定；保存、刷新、预览、移除绑定及恢复静态均通过 |
| 无模型设备 | 通过“资产与指标”新增设备、选择数据源、配置指标并绑定二维组件；实际采集通过 |
| 双向联动 | 表格选择高亮对应模型；三维点击更新指标卡、表格和设备选择器；模型迟到加载会补齐高亮 |
| 移除三维 | 从编辑器删除 3D 组件后保存，二维组件仍正常采集双设备数据 |
| 需求和生命周期 | 同资产多组件共享请求；已有缓存不因重复需求重置；并发有界、迟到结果被忽略；切换项目和离开页面释放原请求与定时器 |
| 异常和恢复 | 真实 mock 返回 null、错误类型、缺失字段、旧时间戳和 HTTP 503；界面不回退示例或变为 0，恢复后自动显示实时数据 |
| 单位 | 表格按每台设备显示各自单位；柱状图对不一致单位明确报错 |
| 服务端边界 | 外项目引用、缺失引用、错误目标/类型、未知字段被拒绝；旧版本保存返回 409；只读成员可读不可写，无项目权限及匿名读取被拒绝 |
| 旧功能回归 | 原静态模板、旧单设备三维、保存重开、旧版 API smoke 均通过 |

综合运行 `pnpm test:newpower`：**13 项通过，1 项示例创建入口按设计跳过**（`acceptance.log`）。随后完成表格逐设备单位显示的 1 项专项复验（`units-recheck.log`）；功能检查合计 14 项。`pnpm check` 和最终 `pnpm build` 通过，API 构建仍为 dry-run。旧版 smoke 的 12 项检查复验通过（`m1-legacy-smoke.log`）。

完整回归在构建后的 `http://127.0.0.1:8791` 进行；专项也验证了 5173 开发页面。`acceptance/` 保存真实 UI 截图和相关失败时的 trace；`m1-model/` 保存选择框、独立设备告警颜色及删除三维后的截图；`m1-final-recheck/` 保存独立资产配置操作。失败的旧检查保留原始日志，已通过上述修复复验，不记为未解决缺陷。

## 亲自操作

1. 打开 [纯二维示例](http://127.0.0.1:8791/#/projects/ead94aa6-63de-42b2-8930-0df588b88147/preview)，点击表格的“模拟设备 001/002”，观察当前设备指标卡切换；温度会随 mock 采集变化。
2. 打开 [二维三维示例](http://127.0.0.1:8791/#/projects/83549ca8-cdab-4e91-b778-1bd9bb9880b2/preview)，点击表格或三维设备，查看模型高亮、指标和表格选择同步。示例立方体是测试模型。
3. 点击“返回编辑”，选择指标卡、柱状图或表格，在右侧“数据绑定”选择设备和指标，点击“应用到组件”，再“保存画布”。刷新重开后绑定保留。
4. 工具栏“资产与指标”用于添加无模型设备及配置指标；“数据源”沿用原 REST 连接配置。模拟源只用于本机联调，不表示真实设备已接入。

如需重新登录，本机隔离演示凭据只保存在证据目录的 `演示登录信息.md`（0600）；不得提交。整个运行目录权限为 0700。该账户不是公司生产账户。

## 继续运行和复验

所有命令在仓库根目录运行，通过 `/Users/inosaki/Documents/Codex/local/tools/dev-env` 使用工作区工具链。当前本机的运行目录记作 `NEWPOWER_RUNTIME`，值为 `/Users/inosaki/Documents/Codex/local/runtime/newpower-01a095a6`。以下独立终端命令重用既有配置与数据，不覆盖令牌：

```sh
# 先检查端口和当前项目的进程；已有正确服务时复用，不重复启动。
pnpm build
pnpm --filter @factory-twin/api exec wrangler d1 migrations apply factory-digital-twin-config --local --persist-to "$NEWPOWER_RUNTIME/test/state" --config "$NEWPOWER_RUNTIME/test/wrangler.jsonc"
# API 与已构建前端
pnpm --filter @factory-twin/api exec wrangler dev --local --ip 127.0.0.1 --port 8791 --inspector-port 9231 --persist-to "$NEWPOWER_RUNTIME/test/state" --config "$NEWPOWER_RUNTIME/test/wrangler.jsonc"
# 另一终端：模拟设备
pnpm dev:mock
# 如需源码热更新，再开一个终端
NEWPOWER_POLL_WATCH=true VITE_DEV_API_TARGET=http://127.0.0.1:8791 pnpm --filter @factory-twin/web exec vite --host 127.0.0.1 --port 5173 --strictPort
```

测试前将下面的变量传给 `pnpm test:newpower`，不要打印会话或令牌内容：

```sh
NEWPOWER_BASE_URL=http://127.0.0.1:8791
NEWPOWER_SESSION_FILE="$NEWPOWER_RUNTIME/session.json"
NEWPOWER_TEST_STATE_DIR="$NEWPOWER_RUNTIME/test/state"
NEWPOWER_TEST_CONFIG="$NEWPOWER_RUNTIME/test/wrangler.jsonc"
NEWPOWER_ARTIFACTS_DIR="$NEWPOWER_RUNTIME/recheck"
```

这些是测试进程的环境变量，需要通过 `export` 或同一次命令传入。`tests/demo-setup.spec.ts` 仅在 `NEWPOWER_SEED_DEMOS=true` 时创建新的示例；已有示例可直接继续使用。修改前先核对服务与数据目录归属，不在用户真实数据库上跑权限夹具。

本轮没有实测公司真实模型、真实工业接口或目标硬件容量；页面内共享请求不等于跨浏览器或生产集中采集已实现。
