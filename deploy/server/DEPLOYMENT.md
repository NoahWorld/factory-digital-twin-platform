# DTwin 服务器部署记录

首次部署：2026-09-28；公网验收及记录更新：2026-09-29。服务器：`8.136.35.33`。

**当前前端已于 `2026-09-29T06:38:25.493284Z` 切换为分类模型库及移动、缩放版本；发布文件校验、服务影响核对及线上专项浏览器 7 组验收均通过。** 乔木、灌木、河流、运输车、帐篷、雷达和装甲车统一从左侧分类模型库添加，选中后可移动、缩放并保存；右侧保留参数编辑、地图和报警配置。此次真实线上检查未出现页面异常、HTTP 错误或越界请求，临时项目已删除、测试会话已撤销。此前统一通知及普通 HTTP UUID 修复保留，后端不变。此前通知版本的公网验收与本轮专项验收使用各自证据，不能相互替代。

用户另行授权的 18 个项目、70 个资源迁移已完成数据库、对象、公网 API、浏览器和同机服务影响验收；4 个本地模拟数据源保持暂停，最终验收证据已归档并核对服务器权限与哈希。迁移有独立验收证据，范围及限制见 [本地到生产迁移](../../docs/local-to-production-migration.md)。历史发布记录继续保留，各版本使用各自的验收证据。

## 版本与位置

| 项目 | 本次部署内容 |
| --- | --- |
| 前端源码 | Codeup `DTwin_UI` 的 `main` 基线：`69af24ef41b914b44d8a36163f50d4992a26047f`，加 2026-09-29 统一通知、分类模型库及移动缩放改动；发布源码快照与校验和随 release 留档 |
| 后端源码 | Codeup `DTwin_Cloud` 的 `main`：`ecd3f476812bcc87a85b692a9040cc9b9a514285` |
| 当前前端发布目录 | `/data/dtwin/releases/dtwin-ui-20260929-model-library-b0csanop-063700286494` |
| 当前前端入口 | `/assets/index-B0CsANOp.js` |
| 前端回滚目标 | `/data/dtwin/releases/dtwin-ui-20260929-notifications-d-dxotyt` |
| 原完整发布与后端构建目录 | `/data/dtwin/releases/dtwin-release-20260928-b5bd9de-ecd3f47`，保留历史构建与诊断记录 |
| 活动配置 | `/data/dtwin/config` |
| 业务数据 | `/data/dtwin/data/postgres`、`/data/dtwin/data/valkey`、`/data/dtwin/data/storage` |
| 独立运行服务持久目录 | `/data/dtwin/docker`、`/data/dtwin/containerd`、`/data/dtwin/containerd-opt` |
| 独立运行服务临时状态 | `/run/dtwin-docker`、`/run/dtwin-containerd` |
| 运维入口 | `/data/dtwin/bin/docker-dtwin`；先检查数据盘挂载与实际 Docker root，再操作本项目 socket |
| 运行日志 | `/data/dtwin/logs`；容器日志位于本项目 Docker 数据目录并按配置轮转 |
| 当前前端发布审计目录 | `/data/dtwin/audit/dtwin-ui-20260929-model-library-b0csanop-063700286494` |
| 首次部署审计目录 | `/data/dtwin/audit/deploy-20260928` |
| 公开地址 | [DTwin](http://8.136.35.33:19080)，当前版本已激活，线上专项浏览器 7 组验收通过 |

前端以 `VITE_API_BASE_URL=/` 构建；首次后端构建使用 JDK 21 执行 `mvn -B verify`，94 项测试通过。后端源码与镜像保持不变；当前前端为上述 main 基线加统一通知、分类模型库及移动缩放改动，不能仅凭基线提交复现现网。发布源码及其 SHA-256 位于新 release 的 `source/`、`source.patch` 与 `release.json`：`source.patch` 包含相对基线的完整已跟踪文件差异，`source/` 包含改动文件及新增前端文件；构建产物逐文件校验和同样记录在 `release.json`。

| 运行组件 | 本次采用的版本系列或构建基线 |
| --- | --- |
| API、collector、worker | 同一独立 Java 后端构建；JRE 21 与 Node 22 |
| PostgreSQL | 实际版本 17.11，Debian Bookworm；`postgres:17-bookworm` 系列，正式运行使用固定镜像引用 |
| Valkey | `valkey/valkey:8.1.3-alpine` |
| SeaweedFS | `chrislusf/seaweedfs:4.47` |
| Nginx | 实际版本 1.28.0；官方 `nginx:stable-bookworm` 渠道，正式运行使用固定镜像引用 |

精确镜像引用、镜像 ID、七个容器状态及源码提交已归档到 `/data/dtwin/audit/deploy-20260928/deployment.json`；不要仅凭可变 tag 复现部署。活动配置校验和在文档同步后归档到同目录 `active-config.sha256`。这两份清单由部署流程生成，不包含凭据。

CentOS 7 / kernel 3.10、runc 1.1.12、libseccomp 2.3.1 环境下，PostgreSQL Alpine 初始化和 Nginx Alpine 实际启动曾出现写入 `EPERM`。本项目分别改用 Bookworm 镜像后通过实际验证，未升级公共运行组件或放宽默认 seccomp。PostgreSQL 有 strace 证据，Nginx 仅有启动错误日志，不能将二者的底层系统调用原因混同。详情见 [兼容性记录](README.md#宿主机兼容性记录)。

## 2026-09-29 分类模型库与移动缩放发布（当前版本）

于 `2026-09-29T06:38:25.493284Z` 切换至 `/data/dtwin/releases/dtwin-ui-20260929-model-library-b0csanop-063700286494`，入口为 `/assets/index-B0CsANOp.js`。部署包 SHA-256 为 `1154aa54c1601a65a7d1b06cc034a38d93f336e5b7c2f30497a25003319b3757`。119 个 web 文件、54 个 source 文件及源码补丁哈希核验通过；相对通知版本上传 10 个变化 web 文件，其余 109 个从旧 release 复制后逐一核验，多余旧文件按 manifest 清理，旧 release 保留。

左侧模型库按植物、水景、军事模型、工业模型、上传模型和背景模型分类，支持分类数量与空态；7 类参数化对象统一从模型库添加。它们与已有模型共用移动、缩放工具，变换同步到右侧参数并可保存；右侧继续编辑对象参数、地图和报警配置。创建与变换保留权限、场景预算、能力及未应用属性校验，旧场景数据无需迁移。

本地前端类型检查、生产构建、57 项 API 错误测试、`scene-runtime`、`scene-extensions`、`standalone-3d` 回归以及隔离浏览器 7 组检查均通过。**本次真实线上专项浏览器 7 组验收也已通过，页面异常、HTTP 错误和越界请求均为 0。** 最终运行编号为 `model-library-browser-0651ca9b-41fe-40e9-8842-42cff4aaa2cc`：7 种参数化对象创建、保存并经 API 回读一致；真实鼠标操作使乔木位置 X 从 `0` 变为 `0.4272`、缩放 X 从 `1` 变为 `1.2576`，保存并刷新后保持一致；原有 GLB 模型添加、保存、刷新也通过。唯一临时项目 `48b11571-e021-453d-a838-84a2b419fc82` 已按精确 ID 删除，测试会话已撤销。

首次浏览器尝试在沙箱启动阶段失败，未创建临时项目；随后针对空场景状态和 `scene-` 前缀节点 ID 修正的是验收断言，未为此修改业务代码。失败轮的临时项目和会话均已清理，不能把这些失败轮记作通过。

最终证据目录为 `/data/dtwin/audit/dtwin-ui-20260929-model-library-b0csanop-063700286494/final-evidence/`，报告路径为 `production-results.json`，同目录保留最终验收脚本、截图及文档；审计根目录的服务器收据路径为 `final-verified.json`、`impact-final.json` 和 `completed.json`。发布包保持打包时的源码与文档快照，后补的验收脚本及文档以 `final-evidence/` 为准，不改写已校验的发布包。

本次发布只重建本项目 Nginx。本项目其他 6 个服务与公共 Docker 中全部 25 个容器的 ID、启动时间及状态均与发布前一致；Compose、Nginx、Valkey 配置未变，`.env` 仅修改 `RELEASE_DIR`。后端、数据和其他项目服务未变更。当前回滚目标为 `/data/dtwin/releases/dtwin-ui-20260929-notifications-d-dxotyt`；仅恢复本项目 `RELEASE_DIR` 并重建自己的 Nginx，随后重新验收。前端回滚不会撤销此前独立完成的业务数据迁移。

## 2026-09-29 统一通知发布（此前版本）

于 `2026-09-29T03:18:22.412472Z` 切换至 `/data/dtwin/releases/dtwin-ui-20260929-notifications-d-dxotyt`，入口为 `/assets/index-D-dXOtyt.js`。119 个 web 文件与 37 个 source 文件核验通过；其中相对前一 release 有 9 个 web 文件需上传，其余 110 个复制到新 release 后逐一核验哈希。新 release 内旧版本多余的入口文件按 manifest 清理，旧 release 保留。

本次将登录、项目、资源、用户管理及编辑操作统一为可关闭、去重的通知，成功提示短时显示，失败提示保留更长时间；持久加载、连接和配置状态仍在对应页面显示。错误码和请求编号等诊断信息仅保留在开发者工具中，界面不再提供原始异常或折叠详情；程序仍保留真实错误类型和失败分支，不将操作失败报告成成功。

本地 API 错误测试 57/57、通知浏览器用例 30/30、登录模拟浏览器用例 14/14，以及前端类型检查、生产构建和相关运行态回归通过。30 项通知用例包含窄屏、主题、去重、关闭、原生模态窗口和全屏容器；release 包内 `test-notifications-browser.mjs` 是最后追加模态窗口用例之前的测试快照，最终测试源码与结果共 5 个文件已归档到 `/data/dtwin/audit/dtwin-ui-20260929-notifications-d-dxotyt/notifications-final-evidence/`，服务器端哈希核对通过；不能将包内脚本与最终测试快照混同。这个差异属于验收脚本留档，不代表发布 UI 未包含模态窗口修复。

本轮真实公网浏览器 7 项检查与接口、资源 10 项检查全部通过，验收临时项目已删除、测试会话已撤销。UI 发布只重建本项目 Nginx，独立 Java 后端与其他服务不变。审计目录为 `/data/dtwin/audit/dtwin-ui-20260929-notifications-d-dxotyt`；这组验收结果仅证明该前端发布，业务数据迁移使用下述独立验收证据。

该通知版本当时的前端回滚目标为 `/data/dtwin/releases/dtwin-ui-20260929-errors-dcaquuqx`。仅恢复本项目 `RELEASE_DIR` 并重建自己的 Nginx，随后重新验收；前端回滚不会撤销任何另行执行的业务数据迁移。

## 2026-09-29 业务迁移、storage 调整与验收

上传约 87.8 MB 对象时，本项目 SeaweedFS storage 在 `2026-09-29T03:23:42Z`、`2026-09-29T03:25:03Z` 两次发生 OOM，已确认原 768 MiB 容器内存上限不足。这是此次迁移受阻的实际原因，不能只延长上传超时或把失败当作对象已完整写入。

检查时宿主机可用内存约 7557 MiB。已于 `2026-09-29T03:31:36.505724Z` 仅将本项目 storage 内存上限改为 2 GiB 并重建该容器，其他服务限额不变；全部 25 个非本项目容器（含运行与停止）对本次变更前快照均未变化。当前 Compose SHA-256 为 `825694545ce9e348a9532b3418cceb322fc30611177686fecfcfc1b823c4136a`。七容器限额合计由 3520 MiB（约 3.44 GiB）增至 4800 MiB（约 4.69 GiB），这不是预留内存，也不包含独立 daemon 或其他共享资源。上述“UI 发布只重建 Nginx”为此前 UI 发布事实，这次 storage 重建属于后续业务迁移修复。

此前失败的约 87.8 MB 对象在 33 秒内上传完成；全部 70 个 S3 对象于 `2026-09-29T03:33:26Z` 上传完成，并于 `03:34:13Z` 通过全部 SHA-256 复核。上调限额后的 storage 未重启，已观测内存峰值约 1.217 GiB；这是本轮观察结果，不保证后续任意负载均能通过。

数据库于 `2026-09-29T03:34:26.425Z` 导入并通过全表 postverify：18 个项目、18 份文档、357 项内容、39 个资产、4 个暂停数据源、184 个绑定、70 个资源、18 个封面、1 个 TwinDrive。公网 API 已匹配全部 18 个项目的完整内容、70 个资源元数据、18 个 PNG 封面，并对 2 个代表资源的签名下载核对 SHA-256；测试会话已撤销。证据为 `import-verify-a4d4ceb1-cf85-4515-8c82-018756b95d5d.json`。

真实浏览器于 `2026-09-29T03:36:43Z` 至 `03:36:57Z` 完成 10/10 检查：9 个 2D 与 9 个 3D 项目及封面、模板入口与预览、2 类资源列表、含 57 个节点的代表 2D 画布与含 3 个内置模型的代表 3D 场景（模型请求共 755,328 字节）。全程没有 pageerror、被阻止请求或 HTTP 错误，检查前后 revision 与文档内容不变，测试会话已撤销。证据为 `import-browser-af06b2b7-8753-4b06-8713-afb35486176f/results.json`。浏览器采用代表项目，不等于逐项运行所有项目交互或大模型压力测试；4 个本地数据源仍暂停。

`2026-09-29T03:39:35.378012Z` 影响核对通过：全部 25 个其他容器、既有用户及原会话不变，PostgreSQL、Valkey 未重启。7 个本项目容器运行，5 个带 healthcheck 的容器均 healthy；storage、Nginx 通过真实请求验证，新 storage 容器重启次数为 0。完整本轮中，本项目 API、collector、worker、storage 因备份在 `03:08:06Z` 至 `03:08:22Z` 暂停并恢复，Nginx 因发布更新，storage 经两次 OOM 后调整内存并重建；此前仅重建单一容器的表述分别限于 UI 发布和 storage 调整步骤，不适用于整个迁移。

**本轮迁移、验收和最终验收证据归档已完成。** 服务器审计根目录为 `/data/dtwin/audit/local-import-20260929/`：`core/` 已归档 16 个核心文件并核对服务器哈希，`core-verified.json` 绑定 runId、文件和归档 SHA-256；`impact-verified.json` 记录影响核对。`backup/` 保留 `postgres.dump`、`objects.tar.gz`、受限 `config.env` 及已通过的恢复演练收据 `verified.json`，供本轮数据回滚使用，前端 release 回滚不会撤销业务导入。`final/` 已归档浏览器结果、7 张截图、API 报告、脚本、Compose 与影响/清理/OOM 证据共 16 个文件，服务器权限和 SHA-256 均通过，收据为 `final-verified.json`。浏览器报告实际为 `final/results.json`，API 为 `final/import-verify-a4d4ceb1-cf85-4515-8c82-018756b95d5d.json`。仅本轮 2 个临时验证数据库已于 `2026-09-29T03:39:57.908496Z` 清理，备份保留；审计根目录 `completed.json` 已于 `2026-09-29T03:42:03.778252Z` 生成，状态为 `complete`，绑定 core/final 校验、其他 25 个容器不变及修复后 storage 无重启证据。范围、身份映射、备份回滚和验收限制见 [迁移记录](../../docs/local-to-production-migration.md)。

## 2026-09-29 中文错误提示发布（此前版本）

于 `2026-09-29T02:28:15Z` 成功切换至 `/data/dtwin/releases/dtwin-ui-20260929-errors-dcaquuqx`，入口为 `/assets/index-DCaqUuQx.js`。该版本以首次部署的 `b5bd9deaf3d48295cc7b44c115ed4a80c2defa4b` 为基线加 HTTP UUID 与中文错误提示补丁，发布时补丁尚未提交或推送。部署包 SHA-256：`b22c85cc3c533e2d179b100bbfb8edd4c1008da62ca42b08f537f27a8176d22e`；上传后全部 119 个 web 文件和 42 个 source 文件核验通过。

该历史版本包含此前 HTTP UUID 修复与公共 API 错误呈现：按稳定错误码提供中文原因和操作建议，登录与首次初始化保留原始错误对象，技术信息默认折叠。错误码、HTTP 状态、无查询参数的请求接口、请求编号与原始信息用于排查，不记录请求正文、认证头或分享令牌；后端代码与镜像不变。该版本的折叠详情已由后续统一通知版本移除，当前模型库版本保留该改动。

本地验证已通过 46 项 API 错误测试、14 项模拟响应的浏览器用例、3 项 UUID 测试、前端类型检查与生产构建。根 `pnpm check` 因 API 检查调用旧全局 TypeScript 4.9.4 失败；改用已安装的兼容 TypeScript 5.9.3 检查 `apps/api` 通过，无相关代码修改，不能将原命令记为通过。

本轮 `verify-browser.mjs` 的真实公网浏览器 7 项检查全部通过，包括新增的失败登录中文详情与改正凭据后成功登录；全程零 pageerror，临时项目已删除、当前会话已撤销。本地审计为 `deploy/server/.local/dtwin-browser-25f78477-5929-463d-9cc5-78c0ad2a6f0f.json`，已归档至本轮服务器审计目录的 `acceptance-browser.json`。

业务影响核对已通过：原 16 个业务容器与本项目其他 6 个容器的 ID、`StartedAt` 和状态均不变，只有本项目 Nginx 重建；默认 Docker 身份与 root、4 个运行配置文件哈希不变。5 个配置健康检查的容器均为 `healthy`。证据为 `/data/dtwin/audit/error-notice-20260929-dcaquuqx/impact.json`。

该轮 `verify.mjs` 的 10 项真实公网接口与资源检查全部通过，新入口及其静态资源也通过校验；临时 2D/3D 项目均已删除，测试会话已撤销。本地审计为 `deploy/server/.local/dtwin-verify-90c42379-3489-4605-8b11-718408797c4b.json`，已归档至该轮服务器审计目录的 `acceptance-api.json`。该历史发布审计目录为 `/data/dtwin/audit/error-notice-20260929-dcaquuqx`。

本轮审计还包含模拟浏览器的 `acceptance-browser-mocked.json`（14 项）、`local-validation.json`、`impact.json`、`switch.json`、`before.json` 及受限配置备份 `.env.before`。`deployment.json` 的当前发布与验收引用已同步，原清单保留为 `deployment.json.before`。

本次前端回滚目标为 `/data/dtwin/releases/dtwin-ui-20260929-http-uuid-365896d8`。回滚仅恢复本项目 `RELEASE_DIR` 并重建自己的 Nginx，随后重新验收；不停止其他 DTwin 服务或公共 Docker。此前完整 release、UUID release 及其审计继续保留。

## 2026-09-29 HTTP UUID 白屏修复（此前版本）

实际浏览器复现证据为 `isSecureContext=false`、`crypto.randomUUID=undefined`、`crypto.getRandomValues=function`。登录展示模型在模块导入阶段创建画布节点，触发 `TypeError`，React 尚未挂载就中断。前端 14 个文件的 18 处调用现统一改用 `apps/web/src/uuid.ts`：直接从浏览器安全随机源生成标准 UUID v4，不修改全局 crypto，不使用 Math.random，不吞掉随机源错误。

验证包括 `pnpm test:uuid`、模板、孪生动作与驱动回归，以及生产构建。部署包 SHA-256：`962ea99b7ef0da9d676e8692ba60b1cc3a1dead52f97aeeb22ef92e0e5bf8687`；上传后核验全部 119 个前端文件和 18 个源码/测试文件。仅修改本项目 `.env` 的 `RELEASE_DIR` 并通过专用 wrapper 重建 `nginx`（`up -d --no-deps nginx`），未变更 Nginx 配置、镜像或其他容器。

真实公网 Chrome 未使用请求拦截、crypto polyfill 或安全上下文绕过。新入口脚本为 `index-O4KX2cRh.js`；首页与登录页及其 3D 展示正常渲染。`verify-browser.mjs` 的 6 项检查通过：普通 HTTP 首页、登录页、管理员进入工作区、真实拖拽纯文本生成 UUID v4 并保存/刷新、临时项目清理、当前会话注销与登录页恢复。全程没有 pageerror。新一轮 `verify.mjs` 的 10 项接口与资源检查也全部通过。Node 检查与浏览器检查分别保留，不能互相替代。

修复审计目录为 `/data/dtwin/audit/uuid-hotfix-20260929`，其中 `acceptance-browser.json`、`acceptance-api.json`、`public-render.json`、`impact.json` 分别记录浏览器、接口、渲染和影响核对。原有 16 个业务容器及本项目另外 6 个容器的 ID/启动时间完全不变，只有 `dtwin-nginx-1` 被重建。旧完整 release 与权限 0600 的 `.env.before` 保留用于回滚。验收脚本调试曾因同名链接和跨标签注销后的页面缓存状态失败，诊断已保留；两次均未遗留临时项目或会话，最终完整浏览器验收通过。

## 首次部署与接口验收记录

2026-09-29 检查时，七个本项目容器均为 Up 16h；PostgreSQL、Valkey、API、collector、worker 五个配置健康检查的容器均为 `healthy`。SeaweedFS storage 和 Nginx 通过真实请求验证，不将没有健康检查的容器写成 `healthy`。实际监听检查确认本项目 13 个内部 TCP 端口全部绑定 `127.0.0.1` 或 IPv4-mapped loopback，唯一公开监听端口为 `19080`。此前首次公网接口验收没有重启服务；随后 UUID 修复只重建了本项目 Nginx。

2026-09-28 服务器本机经 Nginx `19080` 请求前端 `/` 和代理 `/health` 均返回 HTTP 200。本机验收保留公开 Host 与 Origin，通过 loopback 连接完成，结果记录为 `/data/dtwin/audit/deploy-20260928/acceptance-loopback.json`。2026-09-29 又从本地机器使用 Node 24 执行完整公网验收：将 en0 当前已分配的 IP 设为 `DTWIN_LOCAL_ADDRESS`，直接连接真实地址 `http://8.136.35.33:19080`，没有设置 `DTWIN_CONNECT_ORIGIN`。以下 10 项检查在本机 loopback 和真实公网两次验收中均通过：

| 业务检查 | 结果 |
| --- | --- |
| 健康接口确认数据库、状态存储和对象存储正常 | 通过 |
| 匿名访问项目返回 401 | 通过 |
| 管理员登录与会话 Cookie 属性 | 通过 |
| 非允许 Origin 的写请求返回 403 | 通过 |
| 2D 项目创建、节点保存与重新读取 | 通过 |
| 3D 项目创建、模型实例保存与重新读取 | 通过 |
| 前端 JS/CSS、内置 GLB 内容及本地 WASM 解码器 | 通过 |
| PNG 上传、同源签名下载和 Range 读取 | 通过 |
| 分片上传、worker 持久化完成状态和下载内容 | 通过 |
| 两条带身份验证的 WebSocket 完成有效 101 升级 | 通过 |

两次验收的临时 2D/3D 项目均已删除，测试会话退出并确认撤销；公网审计的 `sessionRevoked=true`。公网审计文件为本仓库 `deploy/server/.local/dtwin-verify-f46159c5-fb81-4df1-a9ad-c0969ef3789d.json`，已归档至服务器 `/data/dtwin/audit/deploy-20260928/acceptance-public-20260929.json`。`deployment.json` 已记录 `publicAccess=verified`、`publicAcceptance` 审计引用及 `publicVerifiedAt=2026-09-29T01:28:15.040Z`；文档同步后重新生成活动配置校验和。本机 loopback 与真实公网使用独立审计证据，不能相互替代。

专用 Docker 服务重启后，本项目容器已自动恢复；没有通过重启整台服务器验证开机恢复。`dtwin-containerd.service` 与 `dtwin-docker.service` 已启用自启动，均依赖 `/data` 挂载并执行数据盘 UUID 检查。专用日志轮转 `/etc/logrotate.d/dtwin` 已安装，`logrotate -d` 检查通过，宿主机 `crond` 为 active；尚不能将配置检查等同于已观察到一次定时轮转。

## 对已有业务的核对

部署后的基线对照结果：原有 16 个运行容器的 ID 和 `StartedAt` 完全相同，原 Nginx 配置文件哈希、iptables/ip6tables 规则及 IP forwarding 设置均相同。原业务未被重启，现有 80/443 和原 Nginx 配置未修改。

本项目使用独立 Docker/containerd 的 data root、exec/state、socket 和 namespace；关闭新 daemon 的 bridge、iptables/ip6tables、IP forwarding、IP masquerade 与 userland proxy 管理。新增系统文件仅为本项目两个 systemd 单元、其启用链接及专用 logrotate 配置，其余项目内容在 `/data/dtwin`。

上述对照证明检查项未发生变化，不代表同机资源争用为零，也不代表已经完成原业务性能压测。

## 资源与网络边界

下表为 `2026-09-29T03:31:36.505724Z` storage 调整后的资源限额。首次部署时 storage 为 768 MiB、七容器合计为 3520 MiB（约 3.44 GiB）；本次仅提高 storage 内存上限，CPU 配额合计不变。

| 服务 | 内存上限 | CPU 配额上限 | 监听范围 |
| --- | ---: | ---: | --- |
| PostgreSQL | 512 MiB | 1.0 | loopback `15432` |
| Valkey | 192 MiB | 0.5 | loopback `16379` |
| SeaweedFS storage | 2048 MiB（2 GiB） | 1.0 | loopback：master `19333/29333`、volume `18088/28088`、filer `18888/28888`、S3 `18333/28333` |
| API | 768 MiB | 1.0 | loopback `21080` |
| collector | 384 MiB | 0.5 | loopback `21081` |
| worker | 768 MiB | 1.0 | loopback `21082` |
| Nginx | 128 MiB | 0.5 | 对外 HTTP `19080` |
| 容器配置合计 | 4800 MiB，约 4.69 GiB | 5.5 | 仅 Nginx 作为公开入口 |

这些是各容器限额的合计，不是预占资源，也不是整个部署的总上限。独立 dockerd/containerd、镜像构建、磁盘 I/O、网络带宽和进程数量没有统一总限额；仍与原业务共享宿主机内核、CPU、内存及硬件资源。数据盘对象存储逻辑容量约 512 GiB，不等于文件系统硬配额。

首次部署后的空闲状态采样中，七个容器的 RSS 合计约 885 MiB；`/data` 已用约 2.7G，系统盘剩余约 1.8G，与部署前处于同一量级。这些是当次测量结果，不能作为当前发布用量、高负载用量或未来容量保证。

全部容器使用 host 网络。内部服务绑定 `127.0.0.1` 避免直接公网监听，但不能隔离宿主机其他进程：本机进程仍可访问这些内部端口，本项目容器也能连接其他宿主机端口。管理与数据目录独立不等于独立虚拟机的安全边界。

## 公网阻塞历史与恢复验证

2026-09-28 的外部检查曾出现以下情况：

- 本机 TUN 代理路径返回空响应，不能据此认定请求已到达服务器。
- 从本机 `en0` 直连 `8.136.35.33:19080` 超时；服务器访问自身公网地址也超时。
- 对应检查期间，服务器 `eth0` 抓包未捕获目标 `19080` 的流量。

当时的测试流量未到达主机入口，具体拦截层没有证实。浏览器当时登录的阿里云账号全地域没有显示 ECS，无法查看目标实例规则，用户随后选择自行检查并放行 TCP `19080`；部署操作没有替用户修改云安全组。保留这段历史用于排查，不能仅依据恢复结果把原先根因确定为安全组。

2026-09-29 用户确认放行 TCP `19080`。从本地 en0 直接访问真实公网首页和 `/health` 均返回 HTTP 200，数据库、状态存储及对象存储均为 up；随后完成上述 10 项完整公网验收。另以默认路由（TUN）执行普通 curl 请求首页，同样返回 HTTP 200，因此绑定 en0 是本次验收路径的选择，不是用户访问网站的必要条件。公网入口放行与接口验证已完成；页面执行验证随后在上述 UUID 修复中补齐。

数据盘不是备份；自动异地备份仍未配置，属于后续运维事项。后续变更数据库或存储前按部署说明备份。

## 管理员交付与日常操作

管理员已生成，并按用户授权导出到本仓库 `deploy/server/.local/admin.json`，权限 0600；`.local` 目录已加入 Git ignore。本记录不保存密码、bootstrap token、数据库或对象存储密钥。不要重新初始化或重置现有管理员来进行验收。

日常命令必须使用专用 wrapper，避免误操作原 Docker：

```bash
/data/dtwin/bin/docker-dtwin compose \
  --env-file /data/dtwin/config/.env \
  -f /data/dtwin/config/compose.yml ps
```

故障处理、验收命令与停止流程见 [部署说明](README.md#验收与回滚)。保留数据和诊断证据，不执行全局清理，不重启或修改其他业务。
