# 本机测试数据迁入生产

## 当前状态

**2026-09-29 本轮本地业务迁移及验收已完成。** 18 个项目对应的业务快照与 70 个对象已导入生产，全部对象 SHA-256 复核、数据库全表 postverify、公网 API 内容核对、真实浏览器 10 项检查和同机服务影响核对均通过。4 个本机模拟数据源保持暂停；此次验收不代表这些数据源已接入生产设备。最终验收证据已归档并核对服务器权限与哈希，路径及结果见下文。

本轮向现有生产环境追加业务数据，保留生产账户及其他已有数据，不使用整库恢复覆盖生产，不启动本机模拟设备服务，不修改生产采集来源白名单。

## storage 阻塞修复与导入状态

2026-09-29 对象上传阶段已确认 storage 内存限制不足：上传约 87.8 MB 对象时，本项目 SeaweedFS storage 在 `03:23:42Z` 和 `03:25:03Z` 两次发生 OOM，当时内存上限为 768 MiB。该证据明确了本次失败原因，不能仅按网络超时处理，也不能根据已发送字节数假定对象完整。

检查时宿主机可用内存约 7557 MiB。已于 `2026-09-29T03:31:36.505724Z` 仅将本项目 storage 上限提高至 2 GiB 并重建该容器，其他服务限额不变；全部 25 个非本项目容器（含运行与停止）对本次变更前快照均未变化。七容器内存限额合计由 3520 MiB（约 3.44 GiB）增至 4800 MiB（约 4.69 GiB），当前 Compose SHA-256 为 `825694545ce9e348a9532b3418cceb322fc30611177686fecfcfc1b823c4136a`。可用内存是当时采样值，限额也不代表预占或与其他业务隔离。

此前失败的约 87.8 MB 对象在 33 秒内上传完成；70 个 S3 对象于 `2026-09-29T03:33:26Z` 全部上传，并于 `03:34:13Z` 完成全部 SHA-256 复核。上调限额后的 storage 无重启，已观测内存峰值约 1.217 GiB。

数据库于 `2026-09-29T03:34:26.425Z` 成功导入并通过全表 postverify：18 个项目、18 份文档、357 项内容、39 个资产、4 个暂停数据源、184 个绑定、70 个资源、18 个封面、1 个 TwinDrive。后续公网 API、页面和影响检查均通过，具体范围如下。

## 本轮最终验收与影响

| 检查 | 实际结果 |
| --- | --- |
| 公网 API | 全部 18 个项目完整内容、70 个资源元数据、18 个 PNG 封面匹配；2 个代表资源通过签名下载并核对 SHA-256；测试会话已撤销 |
| 真实公网浏览器 | `2026-09-29T03:36:43Z` 至 `03:36:57Z`，10/10 通过：9 个 2D 与 9 个 3D 项目及封面、模板入口与预览、2 类资源列表、含 57 个节点的代表 2D 画布、含 3 个内置模型的代表 3D 场景（模型请求共 755,328 字节） |
| 浏览器错误及写入核对 | `pageerror`、被阻止请求与 HTTP 错误均为 0；检查前后 revision 与文档内容不变；测试会话已撤销 |
| 同机服务影响 | `2026-09-29T03:39:35.378012Z` 核对通过：全部 25 个其他容器（运行及停止）不变；既有用户与原会话不变；PostgreSQL、Valkey 未重启 |
| 本项目状态 | 7 个容器运行，5 个带 healthcheck 的容器均 healthy；无 healthcheck 的 storage、Nginx 通过真实请求验证；2 GiB 新 storage 容器重启次数为 0 |

整个迁移过程中，本项目 API、collector、worker、storage 因备份在 `03:08:06Z` 至 `03:08:22Z` 暂停并恢复；Nginx 因前端发布重建，storage 随后经历上述两次 OOM 及内存调整重建。不能把“UI 发布只重建 Nginx”或“调整限额只重建 storage”扩展为整个迁移期间只有一个服务发生变化。其他业务未被暂停、重启或修改。

公网 API 证据文件为 `import-verify-a4d4ceb1-cf85-4515-8c82-018756b95d5d.json`，浏览器证据为 `import-browser-af06b2b7-8753-4b06-8713-afb35486176f/results.json`。本轮服务器审计根目录为 `/data/dtwin/audit/local-import-20260929/`：

- `core/` 已归档 16 个核心文件并核对服务器哈希，`core-verified.json` 绑定本轮 runId、16 个文件和归档 SHA-256。
- `impact-verified.json` 记录同机服务、身份、运行配置与 storage 状态核对结果。
- `final/` 已归档浏览器结果、7 张截图、API 报告、脚本、Compose 与影响/清理/OOM 证据共 16 个文件，服务器权限和 SHA-256 均通过，收据为审计根目录的 `final-verified.json`。浏览器报告实际为 `final/results.json`，API 为 `final/import-verify-a4d4ceb1-cf85-4515-8c82-018756b95d5d.json`；本地浏览器 UUID 子目录名不沿用为服务器归档路径。审计根目录 `completed.json` 已于 `2026-09-29T03:42:03.778252Z` 生成，状态为 `complete`，绑定 core/final 校验、其他 25 个容器不变及修复后 storage 无重启证据。

生产写入前备份保留在 `/data/dtwin/audit/local-import-20260929/backup/`，包含 `postgres.dump`、`objects.tar.gz`、受限 `config.env` 和恢复演练收据 `verified.json`。该备份已通过恢复演练，是本轮数据回滚依据；前端 release 回滚只恢复界面版本，不会撤销已导入业务。需要回滚数据时必须以该收据和迁移基线核对恢复范围，协调本项目写入服务并保留导入后新增内容，禁止覆盖其他业务或只恢复数据库而忽略对象一致性。备份含凭据和业务内容，不得提交 Git 或公开输出。

`2026-09-29T03:39:57.908496Z` 清理核对通过，仅删除本轮创建的 2 个临时验证数据库，生产业务和上述备份保留。

数据库内容和对象哈希覆盖全部导入数据，浏览器渲染采用上述代表项目与资源，未逐一运行 18 个项目的全部交互，也未进行高并发或全部大模型压力测试。4 个本地 REST 数据源仍按下文规则暂停，未改生产来源白名单。部署与迁移仍共享宿主机内核、CPU、内存、磁盘及网络；本轮其他容器未变化不等于同机性能影响为零。

## 已确认的源环境

源仓库为同一父目录下的 `factory-digital-twin-platform` 与独立 `factory-digital-twin-backend`。原平台的 `deploy/local/compose.yml` 管理正在运行的 `factory-twin` 栈：

| 服务 | 已查版本 / 本机入口 | 数据位置 |
| --- | --- | --- |
| PostgreSQL | 17，`127.0.0.1:15432`；库 `factory_twin` | `factory-twin_postgres-data` 卷 |
| SeaweedFS / S3 | 4.47，`127.0.0.1:18333` | `factory-twin_object-data` 卷 |
| Java API | `127.0.0.1:18080` | 业务配置在 PostgreSQL，上传文件在 S3 |
| Valkey | 8.1.3，`127.0.0.1:16379` | 临时运行态，不作为业务迁移源 |

源 PostgreSQL 约 15.7 MiB，SeaweedFS 数据卷占用约 419.7 MiB。Flyway V1–V7 均成功；原独立后端与 Codeup 独立后端的迁移 SQL 逐字节一致。生产已查为同一 V1–V7 schema；正式写入前仍须核对版本、校验和与业务列类型。

| 业务内容 | 数量 / 说明 |
| --- | --- |
| 项目 | 18：9 个 2D、9 个 3D，均为 draft |
| 文档 | 18；122 个画布节点、235 个场景实例 |
| 上传资源 | 70 个 ready：66 模型、4 图片；共 436,850,704 字节 |
| 模型派生关系 | 1 条 `source_model_id`，父资源存在；保留 `compression` |
| 资产与指标映射 | 39 资产、4 数据源、184 绑定；所有绑定的资产与源引用均存在 |
| 项目关联 | 5 条 `linked_project_id`，目标项目均存在 |
| 封面 | 18 个 PNG，共 4,464,369 字节；位于 PostgreSQL `project_covers` |
| TwinDrive | 1 份 `twin_drive_documents` 配置 |
| 发布 | 版本、当前指针、分享链接及范围表均为 0 |

70 个对象键均唯一且有 SHA-256，所有模型检查信息的 `externalResourceCount` 都为 0，没有待处理上传或过期上传记录。235 个场景实例引用 200 个内置模型实例和 35 个上传模型实例；上传引用无缺失。2D 的 2 个资源引用中，1 个是内置模型、1 个是上传资源，均可解析。

`newpower-local` 的三份 SQLite 也已只读清点：项目、画布、场景、模型、图片、资产、绑定、数据源和发布表全部为空，仅有身份与迁移等记录，因此不作为本轮业务导入源。

## 模板与文件覆盖

8 个 2D 模板及 1 个 3D 车间模板属于应用代码，不存在独立模板数据库表。原仓库与当前 Codeup 版本的模板内容一致，2D 模板文件仅有已上线 HTTP UUID 兼容修复的差异，不能用原文件覆盖该修复。

`shared/builtin-models.ts` 等模型目录清单一致；原 `apps/web/public/models/` 下 73 个文件共 40,978,922 字节，与当前仓库逐字节一致。内置模板和内置模型随当前前端发布提供，无需再次上传到私有 S3。

业务迁移必须保留全部 70 个上传对象，包括未被当前场景使用的原版、优化版与历史案例模型。不要只扫描当前场景引用来决定迁移范围。对象键包含 `local/` 及历史路径；更换租户时保持对象键原样，只映射数据库的 `tenant_id`。场景、组件、封面、资产、绑定及 TwinDrive 的正式 JSON 配置完整保留，不将对象存储 URL 或临时签名 URL 写回文档。

## 身份与采集状态

源有 2 个用户、18 条 owner 成员关系和 1 个会话。迁移不复制 `users`、`sessions`、`login_attempts`、密码、令牌、旧审计事件、任务租约或 Valkey 运行态。所有源业务租户映射到生产 `dtwin`，每个导入项目的 owner 映射为生产已存在的管理员；目标账户 ID 写入私有迁移计划并在事务中核验，不重建或修改管理员密码。发布相关 `created_by` / `updated_by` 等身份引用也必须按同一规则映射。

4 个数据源均为 REST 轮询，3 个指向 `host.docker.internal:8790`，1 个指向 `127.0.0.1:8790`。均无凭据引用及 URL query，原配置保留在私有业务快照中。

当前 Java 数据源没有 `enabled` 开关；采集器按 `next_poll_at <= now()` 领取任务，每次领取都会增加 `generation`。因此：

- 导出前后比较业务快照时，只忽略数据源的 `next_poll_at`、`lease_owner`、`lease_until`、`generation`；`body`、`updated_at` 及其他业务字段变化仍必须中止迁移。
- 导入时设置 `next_poll_at = 'infinity'`、`lease_owner = NULL`、`lease_until = NULL`、`generation = 0`，使这些测试源保持暂停，并在迁移清单明确记录这一转换。
- 生产 `RUNTIME_ALLOWED_ORIGINS` 保持原配置，不为导入自动扩大白名单。后续正式接入需确认可达来源；修改数据源的现有 API 会把下次采集时间重置为当前时间，来源仍须通过白名单校验。

`factory-fluid-demo-source-1` 是独立可选模拟容器，本次调查时已停止 5 天。它由 `deploy/local/fluid-demo.yml` 使用 Node 执行两份流体模拟脚本，不依赖 Node-RED 流程、凭据或业务数据库；另一旧模拟源由 `pnpm dev:mock` 启动。**本轮不迁移启动这些模拟服务**，页面应保留明确的模拟、未采集或失联状态，模型动画不能作为数据在线的证明。

## 执行与校验约束

迁移入口为 [`scripts/migrate-local-to-server.mjs`](../scripts/migrate-local-to-server.mjs)。导出使用 PostgreSQL `REPEATABLE READ READ ONLY` 事务取得业务表快照，对每个 ready 对象读取并检查长度与 SHA-256，再次读取数据库并核对业务内容未变化。私有目录为 `0700`，JSON、对象和后续审计文件为 `0600`，不得提交 Git 或打印原始业务配置。

导出入口：

```bash
node scripts/migrate-local-to-server.mjs export /absolute/source-platform /absolute/private-bundle
```

`finish-export` 用于已完整导出所有对象、但尚未生成最终清单的目录：重新核对每个文件与当前源业务快照，不下载缺失对象、不忽略变化。导出与校验不修改本机数据库或容器状态。

生产写入前必须备份本项目数据库及现有对象存储，并记录容器与部署配置基线。备份必须恢复演练成功，校验收据绑定本轮 `runId`、目标主机和数据库，创建时间不足 24 小时；正式写入前重新读取服务器备份文件核对 SHA-256，文件真实路径必须位于本轮批准的私有备份目录内。计划和实际写入均应检查所有业务 ID、对象键、schema、目标租户及目标管理员；冲突应报错，不使用覆盖、`ON CONFLICT DO NOTHING` 或替换现有项目制造成功。

`plan` 保存目标业务表与项目成员的私有基线、摘要和完整待执行 SQL。旧计划需补充事务内校验时，显式运行 `refresh-plan`：只有生产业务基线仍与原计划一致才可补充；保留原 `runId`、导入源和目标身份，归档旧计划与 SQL，再更新 SQL SHA-256。它不导入业务数据，也不能把已变化的生产数据偷偷作为新基线。

```bash
node scripts/migrate-local-to-server.mjs plan /absolute/private-bundle /absolute/private-target.json
# 仅已有旧计划需要升级校验时使用；不要重新创建 runId。
node scripts/migrate-local-to-server.mjs refresh-plan /absolute/private-bundle /absolute/private-target.json
node scripts/migrate-local-to-server.mjs objects /absolute/private-bundle /absolute/private-target.json
node scripts/migrate-local-to-server.mjs apply /absolute/private-bundle /absolute/private-target.json
node scripts/migrate-local-to-server.mjs verify /absolute/private-bundle /absolute/private-target.json
```

目标配置和迁移包均为受限本地文件；SSH 与对象存储连接由内部读取，不能把密钥或凭据写入命令、终端输出或本文。隔离数据库演练使用明确的 `dtwin_import_check_` 加数字库名，仅跳过生产对象和备份门禁，其余 SQL、基线与提交前内容校验相同；真实生产 `apply` 不允许跳过这些门禁。

先将对象写入目标私有 S3，再读取目标对象核对长度及 SHA-256。已存在且字节相同的对象复用，已存在但内容不同则中止；新增 PUT 带拒绝覆盖条件。大模型使用按文件大小计算的超时并记录进度与耗时，失败明确退出；重试仍逐个读取目标字节，不能用上次进度假定文件成功。正式 `apply` 要求同一 `runId` 的完整对象核验收据，并在数据库写入前再次 GET 核对全部对象。

对象确认完整后，在一个数据库事务中锁住 14 张业务表及 `project_members`，在锁内双向比较全部实际行与计划基线，然后按外键依赖插入项目、成员、文档、文档项、资源、资产、数据源、绑定、封面和 TwinDrive，以及存在时的发布数据。目标管理员行同时锁定并确认仍启用。保留原业务 ID、revision、时间戳和资源派生关系，只执行已记录的租户、成员及调度状态映射。

`COMMIT` 前再次双向比较每张表与“目标基线 + 本轮导入”的完整预期，以及全部既有和新增成员；比较先经过 PostgreSQL 真实行类型，避免时间与 PNG 字节的文本表示差异，同时保留 JSON 数组顺序和重复行语义。此时任何差异使整个事务回滚。提交成功后先写入“已提交、待后置验证”收据，再进行独立读回验收；后置验证失败必须报告已提交而尚未验收通过，不能声称已回滚。连接在提交阶段中断时也必须先核实数据库结果，不可假定未写入并盲目重试。

数据库回滚不会自动删除已经上传的对象。后续清理只允许删除有证据证明在本轮开始前不存在、且确由本轮新增的对象；相同内容的既有对象或来源无法确认的对象必须保留。传输中断后重试中的 `uploaded: false` 只表示本次执行复用了对象，不能作为导入前就已存在或可安全删除的证明。

验收必须包括表级数量和映射后的业务内容核对、70 个目标对象哈希、关联与资源引用完整性、封面和模型下载，以及真实浏览器的项目列表、2D/3D 展示和内置模板入口。最后核对已有账户、其他业务容器及运行配置未变化，并归档实际结果；仅对象上传成功或数据库计数正确不足以声明整个迁移完成。

## 历史工具的适用范围

[`docs/cloudflare-to-local-migration.md`](./cloudflare-to-local-migration.md) 与 `scripts/import-wrangler-local.mjs` 记录旧 D1/Wrangler 到本机的迁移；该导入器不能覆盖当前封面、TwinDrive、派生模型及发布结构，不能直接作为本次生产迁移工具。

`scripts/backend-backup.mjs` 固定使用本机 Compose，备份时会暂停该栈的写入服务并复制数据库、对象目录和私有配置；`backend-verify-backup.mjs` 会在本机 PostgreSQL 创建临时恢复库。它们是历史本机备份/恢复工具，不是只读清点命令，也不能直接用于覆盖生产。现存 2026-09-17/18 备份早于当前 18 个项目，不能替代本轮一致性快照和生产写入前备份。
