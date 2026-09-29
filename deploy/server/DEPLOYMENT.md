# DTwin 服务器部署记录

首次部署：2026-09-28；公网验收及记录更新：2026-09-29。服务器：`8.136.35.33`。

**前后端已部署；当前前端已于 `2026-09-29T02:28:15Z` 切换为中文错误提示版本，本轮 7 项公网浏览器检查、10 项接口与资源检查及业务影响核对均通过。** 此版本保留已验证的普通 HTTP UUID 白屏修复，新增公共 API 中文错误提示及登录/初始化折叠详情；后端不变。本轮临时项目与测试会话均已清理；此前 UUID 修复版本的验证记录继续保留，各版本使用各自的验收证据。

## 版本与位置

| 项目 | 本次部署内容 |
| --- | --- |
| 前端源码 | Codeup `DTwin_UI` 的 `main` 基线：`b5bd9deaf3d48295cc7b44c115ed4a80c2defa4b`，加 2026-09-29 HTTP UUID 修复与中文错误提示补丁（服务器发布时尚未提交或推送，修复源码现随本仓库维护） |
| 后端源码 | Codeup `DTwin_Cloud` 的 `main`：`ecd3f476812bcc87a85b692a9040cc9b9a514285` |
| 当前前端发布目录 | `/data/dtwin/releases/dtwin-ui-20260929-errors-dcaquuqx` |
| 当前前端入口 | `/assets/index-DCaqUuQx.js` |
| 前端回滚目标 | `/data/dtwin/releases/dtwin-ui-20260929-http-uuid-365896d8`，保留 HTTP UUID 修复 |
| 原完整发布与后端构建目录 | `/data/dtwin/releases/dtwin-release-20260928-b5bd9de-ecd3f47`，保留历史构建与诊断记录 |
| 活动配置 | `/data/dtwin/config` |
| 业务数据 | `/data/dtwin/data/postgres`、`/data/dtwin/data/valkey`、`/data/dtwin/data/storage` |
| 独立运行服务持久目录 | `/data/dtwin/docker`、`/data/dtwin/containerd`、`/data/dtwin/containerd-opt` |
| 独立运行服务临时状态 | `/run/dtwin-docker`、`/run/dtwin-containerd` |
| 运维入口 | `/data/dtwin/bin/docker-dtwin`；先检查数据盘挂载与实际 Docker root，再操作本项目 socket |
| 运行日志 | `/data/dtwin/logs`；容器日志位于本项目 Docker 数据目录并按配置轮转 |
| 当前前端发布审计目录 | `/data/dtwin/audit/error-notice-20260929-dcaquuqx` |
| 首次部署审计目录 | `/data/dtwin/audit/deploy-20260928` |
| 公开地址 | [DTwin](http://8.136.35.33:19080)，当前版本公网浏览器、接口与资源验收均通过 |

前端以 `VITE_API_BASE_URL=/` 构建；后端使用 JDK 21 执行 `mvn -B verify`，94 项测试通过。后端源码与镜像保持不变；当前前端为上述 main 基线加 HTTP UUID 修复与中文错误提示补丁，不能仅凭基线提交复现现网。补丁对应文件及其 SHA-256 位于新 release 的 `source/`、`source.patch` 与 `release.json`，其中 `source/` 包含新增文件；构建产物逐文件校验和同样记录在 `release.json`。

| 运行组件 | 本次采用的版本系列或构建基线 |
| --- | --- |
| API、collector、worker | 同一独立 Java 后端构建；JRE 21 与 Node 22 |
| PostgreSQL | 实际版本 17.11，Debian Bookworm；`postgres:17-bookworm` 系列，正式运行使用固定镜像引用 |
| Valkey | `valkey/valkey:8.1.3-alpine` |
| SeaweedFS | `chrislusf/seaweedfs:4.47` |
| Nginx | 实际版本 1.28.0；官方 `nginx:stable-bookworm` 渠道，正式运行使用固定镜像引用 |

精确镜像引用、镜像 ID、七个容器状态及源码提交已归档到 `/data/dtwin/audit/deploy-20260928/deployment.json`；不要仅凭可变 tag 复现部署。活动配置校验和在文档同步后归档到同目录 `active-config.sha256`。这两份清单由部署流程生成，不包含凭据。

CentOS 7 / kernel 3.10、runc 1.1.12、libseccomp 2.3.1 环境下，PostgreSQL Alpine 初始化和 Nginx Alpine 实际启动曾出现写入 `EPERM`。本项目分别改用 Bookworm 镜像后通过实际验证，未升级公共运行组件或放宽默认 seccomp。PostgreSQL 有 strace 证据，Nginx 仅有启动错误日志，不能将二者的底层系统调用原因混同。详情见 [兼容性记录](README.md#宿主机兼容性记录)。

## 2026-09-29 中文错误提示发布

于 `2026-09-29T02:28:15Z` 成功切换至 `/data/dtwin/releases/dtwin-ui-20260929-errors-dcaquuqx`，入口为 `/assets/index-DCaqUuQx.js`。部署包 SHA-256：`b22c85cc3c533e2d179b100bbfb8edd4c1008da62ca42b08f537f27a8176d22e`；上传后全部 119 个 web 文件和 42 个 source 文件核验通过。

本次包含此前 HTTP UUID 修复与公共 API 错误呈现：按稳定错误码提供中文原因和操作建议，登录与首次初始化保留原始错误对象，技术信息默认折叠。错误码、HTTP 状态、无查询参数的请求接口、请求编号与原始信息用于排查，不记录请求正文、认证头或分享令牌；后端代码与镜像不变。

本地验证已通过 46 项 API 错误测试、14 项模拟响应的浏览器用例、3 项 UUID 测试、前端类型检查与生产构建。根 `pnpm check` 因 API 检查调用旧全局 TypeScript 4.9.4 失败；改用已安装的兼容 TypeScript 5.9.3 检查 `apps/api` 通过，无相关代码修改，不能将原命令记为通过。

本轮 `verify-browser.mjs` 的真实公网浏览器 7 项检查全部通过，包括新增的失败登录中文详情与改正凭据后成功登录；全程零 pageerror，临时项目已删除、当前会话已撤销。本地审计为 `deploy/server/.local/dtwin-browser-25f78477-5929-463d-9cc5-78c0ad2a6f0f.json`，已归档至本轮服务器审计目录的 `acceptance-browser.json`。

业务影响核对已通过：原 16 个业务容器与本项目其他 6 个容器的 ID、`StartedAt` 和状态均不变，只有本项目 Nginx 重建；默认 Docker 身份与 root、4 个运行配置文件哈希不变。5 个配置健康检查的容器均为 `healthy`。证据为 `/data/dtwin/audit/error-notice-20260929-dcaquuqx/impact.json`。

本轮 `verify.mjs` 的 10 项真实公网接口与资源检查全部通过，新入口及其静态资源也通过校验；临时 2D/3D 项目均已删除，测试会话已撤销。本地审计为 `deploy/server/.local/dtwin-verify-90c42379-3489-4605-8b11-718408797c4b.json`，已归档至本轮服务器审计目录的 `acceptance-api.json`。当前发布审计目录为 `/data/dtwin/audit/error-notice-20260929-dcaquuqx`。

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

| 服务 | 内存上限 | CPU 配额上限 | 监听范围 |
| --- | ---: | ---: | --- |
| PostgreSQL | 512 MiB | 1.0 | loopback `15432` |
| Valkey | 192 MiB | 0.5 | loopback `16379` |
| SeaweedFS storage | 768 MiB | 1.0 | loopback：master `19333/29333`、volume `18088/28088`、filer `18888/28888`、S3 `18333/28333` |
| API | 768 MiB | 1.0 | loopback `21080` |
| collector | 384 MiB | 0.5 | loopback `21081` |
| worker | 768 MiB | 1.0 | loopback `21082` |
| Nginx | 128 MiB | 0.5 | 对外 HTTP `19080` |
| 容器配置合计 | 3520 MiB，约 3.44 GiB | 5.5 | 仅 Nginx 作为公开入口 |

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
