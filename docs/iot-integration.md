# `iot-3d` 接入约定

更新于 2026-10-21。前端分支 `iot-3d` 从 `main` 的 `61c71a1` 创建。IoT 前后端继续在当前 `huanggang-jinshuyan` 分支开发，不升级 Umi 2 / React 16 / Node 16 或 Java 8 / Spring Boot 2.3.7 / WebFlux。独立 DTwin 后端未修改、未启动。

## 当前范围

IoT 后端已新增项目与数量统计、分页、2D 画布、3D 场景、模型/图片/音视频/封面、资产台账、数据源和指标映射、数据驱动、发布快照及运行数据接口。代码和本地验证不代表已上线，也不代表已完成现场设备验收。AI 场景底座、BIM/CAD 转换、写实重建和模型压缩后台任务没有移植，前端对应入口已隐藏。

## 运行与部署

1. IoT 前端：Node 16.20.2、npm 8，`npm run start:dev`，端口 8000。
2. IoT 后端：Java 8，沿用原配置与基础服务；本机端口 18848。
3. DTwin：Node 24.0.2、pnpm 10，`pnpm dev:web`，端口 5173。
4. 在已登录 IoT 的同一浏览器、同一用户配置中打开 `http://localhost:8000/twin/`。

IoT `/twin` 开发代理保留路径，以 HTTP 转发到 5173。**不要给 `/twin` 启用 Umi 2 的 WebSocket 代理**：旧升级处理器与 Vite HMR 冲突会触发 `ERR_STREAM_WRITE_AFTER_END`，使 8000 进程退出。Vite HMR 在本地直接连接 127.0.0.1:5173；原 IoT `/cloud` 代理保持不变。

Chrome 与 Codex 内置浏览器不共享会话；`localhost`、`127.0.0.1`、不同端口也不共享 localStorage。直接打开 5173 无法复用 8000 的会话。不要复制令牌到 URL 或环境文件。

构建产物为 `apps/web/dist`，基路径 `/twin/`，使用 hash 路由。部署时将产物放在 IoT 同源 `/twin/`；模型/脚本不存在时返回 404，不能返回 HTML。生产构建不需要 Vite 或 HMR。API 配置如下：

| 配置 | 用途 |
| --- | --- |
| `VITE_IOT_API_PREFIX` | 开发 `/cloud`，生产 `/cloudPro/api`；同源路径 |
| `VITE_IOT_HOME_PATH` / `VITE_IOT_LOGIN_PATH` | 默认 `/`、`/user/login` |
| `IOT_DEV_API_TARGET` | Vite 代理目标，默认 `http://127.0.0.1:18848` |
| 后端 `twin.api-prefix` | 默认 `/cloud`；生产须与前端一致，通常 `/cloudPro/api`，用于生成文件访问链接 |
| 后端 `twin.storage.bucket` | 可选独立私有桶；默认现有 IoT 桶名加 `-twin`，不能等于原 IoT 桶 |

`VITE_IOT_RESOURCE_ORIGINS` 默认只允许同源；当前文件代理无需配置跨域 MinIO origin。

## 身份与访问范围

- 读取 IoT `x-access-token`，以 `X-Access-Token` 请求 `/authorize/me` 验证身份。
- **登录 IoT 即可使用 2D/3D、项目与资源，不需要 `twin-project`、`twin-resource` 等额外权限。** 没有独立登录、用户管理、密码库或退出入口。
- 后端每次业务请求仍验证 IoT 登录；按已有租户隔离，非租户账号共用 `system` 工作区。兼容 DTO 的 `projectRole:owner`、`editable:true` 不表示另建成员管理。
- 设备数据通过 IoT 原设备控制器代理读取，保留原设备访问权限；孪生模块不会扩大设备数据权限。
- 无会话引导 IoT 登录，401 标记会话失效；403 显示原访问拒绝。聚焦校验同一身份不会卸载编辑器、丢弃未保存草稿；账号变化后旧请求不得写入新工作区。
- 匿名分享已停用。发布版本仍需 IoT 会话。

## 数据与接口

前端统一通过 `apps/web/src/api.ts`，将逻辑 `/api/v1/*` 映射到 `{API_PREFIX}/twin/*`。成功 JSON 要求 `{status:200,result:...}`；错误保留 HTTP 状态、业务 `code` 和 `requestId`，不把失败当成空列表或假成功。

| 接口族（IoT 控制器前缀 `/twin`） | 实现 |
| --- | --- |
| `/projects`、`/projects/count` | 项目创建、查询、数量、分页；列表 `nextOffset` 为空结束 |
| `/projects/{id}` | 改名、删除；删除前检查跨项目与发布引用 |
| `/projects/{id}/scene`、`canvas` | 场景/画布读取与增量保存，`expectedRevision` 并发检查、结构与预算校验 |
| `/projects/{id}/model-assets`、`image-assets`、`media-assets` | 列表、原始文件体上传、元数据、使用情况、删除引用保护 |
| `/projects/{id}/cover` | 960×540 PNG，最多 2 MiB；源文档与封面版本检查 |
| `/projects/{id}/assets`、`data-sources`、`data-bindings` | 资产、IoT 数据源、字段探测和指标映射 |
| `/projects/{id}/twin-drive` | 配置、数据源检查、真实采样快照 |
| `/projects/{id}/publications` | 草稿检查、不可变快照、激活版本和运行数据 |
| `/projects/{id}/canvas/runtime`、`scene/runtime` | 画布组件/管路、3D 流体状态的 IoT 点位读取 |
| `/projects/{id}/publications/{publication}/projects/{child}/canvas/runtime`、`scene/runtime` | 发布运行态，按冻结文档生成点位清单，实时值仍取自 IoT |

具体路由与 DTO 以 IoT `standalone/twin` 控制器、`shared/` 契约为准。项目列表消费者统一遍历分页，异常分页明确报错。

后端使用新增 `iot_twin_project` 表，保存租户范围、创建者、版本、更新时间和项目 JSON 聚合。单聚合上限 16 MiB；更改采用可串行化事务及版本条件更新。发布快照冻结文档、关联项目和映射；实时值仍来自 IoT。删除已被使用的资源或项目会被拒绝。现有 IoT 设备、用户和业务表逻辑不变。

## MinIO 文件

复用 IoT 现有 MinioClient/存储配置，使用独立私有桶；不修改原 IoT 桶策略。文件先经 IoT 登录、范围与真实格式检查，再写 MinIO；元数据写 IoT 数据库。上传失败不能生成成功记录。上传采用原始文件体和 `filename` 参数，不使用 multipart。

资源 access 接口返回 `{url,expiresAt}`。当前 URL 是同源 `{API_PREFIX}/twin/content/{短期文件票据}`，由 Redis 保存 120 秒，再由 IoT 流式读取 MinIO。票据只授予单个文件读取，不包含 IoT 登录令牌或 MinIO 密钥。票据在有效期内可重复下载，过期返回明确错误；它不是公开桶或永久链接。

前端统一通过 `src/iot/resources.ts` 获取访问地址，缓存按会话隔离，二进制下载不附带 IoT 令牌。内置示例资源属于明确白名单的前端公开静态文件。封面成功后再标记 ready，旧封面延迟清理，失败保留错误日志。当前内容代理提供完整文件响应，尚未实现媒体 Range 分段/拖动播放优化。

## 真实设备数据

数据源使用逻辑地址 `/iot/devices/{设备ID}/snapshot`，多设备 ID 以逗号分隔，最多 64 个；不接受任意外部 URL 或额外凭据。它是 IoT 后端内部适配标识，不是浏览器直连设备地址。

单设备字段通常为 `properties.属性ID`，多设备为 `devices[0].properties.属性ID`。保留每个属性的采样时间；设备无上报、字段缺失、访问拒绝和超时明确报错。2D 绑定点位填写 `设备ID/属性ID`。尚未新增 IoT 设备选择器，需要填写真实 ID。

实时传输采用有界 REST 轮询，不再申请 WebSocket 票据；包含超时、退避重试、修订号/序列检查，最多 6 次失败后停止并显示重试状态。关闭场景取消请求，401 停止采集。已有插值、状态色、阈值告警和设备详情使用映射数据；尚未另接 IoT 原生告警事件流，不能把阈值效果宣称为原生告警联动。

## 工艺管路与状态联动

2D 组件库的“基础图形 → 工艺管路”支持自由端点、设备四边锚点、直角走向和最多 32 个途经点。拖动端点到组件边缘可以吸附，右侧也可指定连接组件和连接位置；双击管路增加途经点，拖动或输入坐标调整路径。端点/途经点可聚焦后使用方向键移动。多条管路接同一设备形成分支，设备移动或缩放时锚点跟随。删除仍被连接的设备会明确阻止，先解除对应连接即可。管路不提供自动避障或工艺仿真。

选中 2D 组件/管路，或在 3D 的“流体属性”中开启“由 IoT 点位驱动”，填写真实的 `设备ID/属性ID`，选择数字、布尔或文本类型、过期秒数，并配置 1–8 条有序规则。第一条匹配规则生效；数字支持等于及大小比较，文本和布尔仅支持等于。规则控制状态名、颜色和可见性，管路/流体额外支持流动开关、正反向与视觉速度（0 表示停止）。视觉速度不代表实测流量。切换类型会重置规则；无效草稿会阻止保存，不能保存旧值来伪装成功。

编辑态展示静态配置；预览和已发布运行态使用实时状态。缺失点位、坏质量、陈旧值、类型不符、未匹配状态或请求失败都显示具体原因，管路/流体变灰并停止流动，不回退到静态“运行”配置。管路旁保留简短异常状态，完整诊断在画布外的独立提示区按管路名称列出，避免遮挡设备。状态投影不会写回画布/场景。2D 与 3D 可绑定同一点位；当前仍需分别配置 2D 管路和 3D 路径，没有自动转换能力。

点位清单合并数值绑定与状态绑定，相同点位去重、类型冲突拒绝、过期阈值取更严格值；单文档最多 500 个点位和 64 个设备。后端读取保留原 IoT 权限和属性采样时间，单次读取有超时，发布版只使用快照内的绑定。共享契约在 `shared/process-control.ts`，IoT 后端通过 `scripts/backend-contracts.mjs --iot --backend-dir <IoT后端路径>` 同步，并用同命令追加 `--check` 检查。

## 验证记录与边界

2026-10-22 管路与状态联动本地验证：

- Chrome 经 IoT 同源入口创建「管路与状态联动 · 功能验证」，保存 6 个设备标记、5 条管路及冷凝支路，刷新后数据完整；移动、缩放设备时连接端点跟随，连接保护和键盘端点调整有效。
- 点位格式无效时阻止保存；配置保存后重开仍保留。故意使用不存在的 `verification-missing-device/running` 验证缺失设备提示，运行页对应管路变灰并停止流动。
- 创建「3D 流体状态联动 · 功能验证」，保存三点流体路径、停止/运行规则、反向及视觉速度 2，重开保留全部配置；预览明确显示缺失设备错误。
- `pnpm check`、`pnpm build`、`test:process-control`（9 组）、`test:iot-embed`（13 项）、`test:iot-integration`（16 项）、`test:scene-runtime` 通过，IoT 后端契约同步检查通过。构建仍有既有的大分块体积提示。
- 发布 3D 与关联 2D 叠加画布入口已有渲染回归，覆盖共享流体投影、正常流动、过期停流及错误提示，确认运行值不会改写发布快照。
- Java 8 定向回归共 25 项通过：孪生契约 11 项、隔离 4 项、黄冈流程 8 项、通知 2 项，并成功打包。

以上未使用真实生产点位，成功状态切换、坏质量/陈旧及反向停止由定向测试覆盖；现场设备及账号权限还需实际联调，不能将配置保存与错误提示验证等同于现场验收。

2026-10-21 本地 Chrome + IoT 后端 + PostgreSQL + Redis + MinIO 实际验证：

- 已登录账号直接进入 3D，无额外孪生授权。
- 创建「IoT 3D 联调验证」，放置模型，保存修订 1，刷新重开正常渲染。
- 生成封面并写入 MinIO；创建、激活「IoT 联调快照」，固定版本运行页成功渲染。
- 在该测试项目上传 `handling-cell.fc8895589305.glb`，资源数量增加，私有文件通过 IoT 访问链接成功渲染。
- IoT 8000、Vite 5173、后端 18848 均运行；不再复现 HMR 导致的 8000 进程退出。

前端 `pnpm check`、`pnpm build`、`test:iot-integration`（16 项）、`test:api-errors`（57 项）通过；实时驱动测试也已通过。后端 `TwinContractsTest` 7 项通过并打包成功，覆盖契约、修订号、IoT 数据/权限传播、Spring 代理、发布冻结与引用保护。隔离测试不能替代现场设备验收。

仍需用真实上报设备核对属性、采样时间、断线/陈旧、阈值告警及多租户账号；未宣称完成这些现场验证。AI/BIM 等后台任务未移植。Git 提交与推送不等于部署到服务器，原独立后端数据未迁移或删除。
