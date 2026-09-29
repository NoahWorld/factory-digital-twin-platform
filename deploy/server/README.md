# 数据盘独立部署

本目录是服务器部署配置，与 `deploy/local` 的开发环境分开。2026-09-28 已按用户确认部署：7 个本项目容器运行，本机 10 项业务验收、专用 Docker 重启恢复及原业务基线对照通过，自启动和专用日志轮转已配置。2026-09-29 用户确认放行 TCP `19080` 后完成 10 项公网接口与资源验收，随后 HTTP UUID 白屏修复另行通过 6 项真实浏览器检查；上述验收的临时项目与会话均已清理。

当前前端于 `2026-09-29T02:28:15Z` 切换至 `/data/dtwin/releases/dtwin-ui-20260929-errors-dcaquuqx`，保留 HTTP UUID 修复并新增公共 API 中文错误提示及登录/初始化折叠详情；后端不变。**本轮 7 项真实公网浏览器检查、10 项接口与资源检查以及业务影响核对均已通过。** 临时项目已删除、测试会话已撤销，只有本项目 Nginx 重建。访问地址为 [DTwin](http://8.136.35.33:19080)，版本与验证证据见 [部署记录](DEPLOYMENT.md)。

## 范围与约束

- 应用代码以 Codeup `main` 为基线。2026-09-28 核对：前端 `b5bd9deaf3d48295cc7b44c115ed4a80c2defa4b`，独立 Java 后端 `ecd3f476812bcc87a85b692a9040cc9b9a514285`。现网前端另含 2026-09-29 HTTP UUID 修复与中文错误提示补丁，发布时补丁尚未提交或推送，其源码和校验和已随独立前端 release 留档；修复、测试与部署配置在本仓库统一维护，后端不变。
- 应用、数据库、对象存储、镜像层、构建临时文件和运行日志全部在 `/data/dtwin`。不迁移本地业务数据，不复用既有业务的数据库或存储。
- 现有服务器 Docker、Nginx、业务容器、目录和防火墙规则保持不变。不执行全局 prune、重启或移动 Docker root。
- 本项目新增 `dtwin-containerd.service`、`dtwin-docker.service` 和自己的日志轮转配置。复用已安装的二进制，但 root、state、socket、namespace 和配置完全独立。
- Docker 官方将同机多 daemon 标为 experimental。用户已确认本次独立服务部署调整，可在本项目范围内安装、启动和验收；即使目录分开仍共享内核、CPU、内存和磁盘。参考 [Docker 多实例说明](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons)。

## 目录和网络

```
/data/dtwin/
  bin/                  # check-mount、docker-dtwin
  config/               # .env、daemon、containerd、Nginx、Valkey、SeaweedFS
  releases/<release>/   # web/、backend 构建输入、版本与校验和
  data/                 # postgres/、valkey/、storage/
  docker/               # 镜像、容器层和轮转后的容器日志
  containerd/           # 独立 containerd 持久状态
  containerd-opt/       # 独立 containerd opt 插件目录
  tmp/ logs/ audit/ incoming/
```

Nginx 独占一个新 HTTP 端口 `19080`，同时提供前端、`/api/`、WebSocket、`/health` 和 `/factory-twin/` 的签名对象代理。现有 80/443 不改动；服务器本机和真实公网业务链路均已验证。此前公网阻塞与用户确认放行后的验证分别留档，不将安全组拦截追认为已证实的根因。

所有容器使用 host 网络，但内部程序必须绑定 `127.0.0.1`，不可仅依赖 Compose `ports`。数据库 15432、Valkey 16379、API/collector/worker 21080/21081/21082。SeaweedFS 的 master 19333/29333、volume 18088/28088、filer 18888/28888、S3 18333/28333 全部为 loopback；禁用额外 Iceberg、Lance、metrics、debug 和遥测端口。

SeaweedFS 4.47 使用 `server`，不使用 `mini`：mini 的 Admin gRPC 存在全接口监听，且可能自动更换冲突端口。服务器配置通过真实监听检查后才可验收。

对象存储配置最多 32 个 16 GiB 卷，逻辑容量约 512 GiB，其余数据盘空间留给数据库、镜像和后续备份；这不是文件系统硬配额。两个独立运行服务禁用 core dump，避免崩溃转储占用系统盘。

前端以 `VITE_API_BASE_URL=/` 构建。`PUBLIC_ORIGIN`、`ALLOWED_ORIGINS` 必须是完全一致的公开地址（含端口），HTTP 用 `SECURE_COOKIE=false`；启用 HTTPS 时同步改为 true。签名 S3 公网端点没有额外 `/s3` 前缀，Nginx 必须保留 Host（含端口）、完整路径、查询与 Range。不要记录访问查询字符串。

## 宿主机兼容性记录

2026-09-28 实际部署中，PostgreSQL 17.11 Alpine 在 CentOS 7 / kernel 3.10、runc 1.1.12、libseccomp 2.3.1 的服务器上执行 `initdb` 失败；保留的 strace 显示 `pwritev2(..., RWF_NOAPPEND)` 返回 `EPERM`。本项目已改用 PostgreSQL 17 Bookworm 系列镜像，`POSTGRES_IMAGE` 示例为 `postgres:17-bookworm`，正式部署仍固定实际镜像 digest；该镜像在默认 seccomp 下初始化成功，PostgreSQL 已健康。此调整只更换本项目镜像，未升级宿主机公共组件，也未放宽 seccomp。更换镜像平台或基础发行版时，必须重新做真实初始化和健康检查，不能仅凭镜像可拉取判断兼容。

同一宿主机上，`nginx:stable-alpine` 通过了 `nginx -t`，但实际启动时写 `/tmp/nginx.pid` 报 `pwrite()` 返回 `EPERM`，导致启动失败。Nginx 未进行 strace，因此这里只记录实际错误，不能据此断言它与 PostgreSQL 使用了相同的失败系统调用。改为同一 stable 渠道的官方 `nginx:stable-bookworm` 后，保持相同 Nginx 配置与默认 seccomp，实际 Nginx 1.28.0 已成功启动；在服务器本机经 19080 请求前端 `/` 和代理 `/health` 均返回 200。`NGINX_IMAGE` 示例已改为 Bookworm，正式部署固定实际镜像 digest。后续验收必须包含真实启动及 HTTP 请求，`nginx -t` 不能替代该检查；本次本机和真实公网的业务验收均已通过，证据见 [部署记录](DEPLOYMENT.md)。

Valkey 的 `valkey-cli` 健康检查使用 `REDISCLI_AUTH` 环境变量读取密码，Compose 将其赋值为本项目的 `VALKEY_PASSWORD`；认证失败必须使健康检查失败，不能省略密码或忽略错误。以上兼容性检查之后，本机和真实公网业务验收均已通过，详见 [部署记录](DEPLOYMENT.md)。

## 构建与首次部署步骤

1. 检查两仓库工作区和最新 main；在独立后端使用 JDK21 运行 `mvn -B verify`，前端运行 `VITE_API_BASE_URL=/ pnpm --filter @factory-twin/web build`。不从平台历史 `apps/backend` 构建。
2. 记录所有既有运行容器的 ID/启动时间、默认 Docker ID/root、iptables/ip6tables、IP forwarding、既有 Nginx 配置哈希。确认所有拟用端口空闲，`/data` 已挂载且 XFS `ftype=1`。
3. 按已确认的独立运行方案，将本目录的配置复制到 `/data/dtwin/config`；将挂载盘 UUID 写到 `config/data-disk.uuid`。安装两个独立 systemd unit 和 `check-mount`、`docker-dtwin`。启动前运行 `dockerd --validate --config-file=/data/dtwin/config/daemon.json`。
4. 先启动自己的 containerd 和 Docker，核实进程参数、所有 root/state/socket 路径和空的容器清单，再进行镜像操作。所有后续命令只用 `/data/dtwin/bin/docker-dtwin`，脚本会检查实际 Docker root。
5. 将构建产物传到新 release 目录并验证 SHA-256。把 `backend.jar`、后端 `meshopt/worker.mjs` 与 `Dockerfile.backend` 放在同一构建上下文，使用已核实的 Linux/amd64 Node22/JRE21 镜像（固定 digest）构建后端镜像。
6. 从 `.env.example` 生成权限 0600 的 `config/.env`，生成随机数据库、Valkey、S3 和 bootstrap 密钥，替换真实公开地址、release 路径和镜像 digest。任何凭据不得进入 Git、静态资源或日志。
7. Valkey 用 UID/GID 10001，数据目录和配置文件需匹配；配置含 `bind 127.0.0.1`、`port 16379`、`dir /data`、`appendonly yes`、`maxmemory 128mb`、`maxmemory-policy noeviction` 与随机 `requirepass`。健康检查通过 `REDISCLI_AUTH` 读取同一密码。
8. SeaweedFS 用 UID/GID 10002，提前创建并授权 `storage/volumes`、`storage/master`、`storage/filer`。`config/seaweedfs/filer.toml` 设置 `[leveldb2] enabled=true; dir="/data/filer"`。`s3.json` 仅包含本项目随机账号，授予本实例 Admin/Read/Write/List/Tagging，无 anonymous 身份；Admin 用于 API 启动时配置 bucket CORS。
9. Compose 先启动 postgres、valkey、storage。仅首次通过 `weed shell -master=127.0.0.1:19333 -filer=127.0.0.1:18888` 执行 `s3.bucket.create -name factory-twin -owner dtwin-app`，失败应中止。之后启动 API、collector、worker、Nginx，必须等待健康检查通过。
10. 使用 bootstrap token 初始化唯一 admin，生成并保存随机密码到权限 0600 的本地交付文件及服务器受限目录。不要重置已有账号；若实例不是新安装，应中止并检查。
11. 执行本目录 `verify.mjs` 的接口与资源验收，并执行 `verify-browser.mjs` 的真实浏览器验收；检查公开端口和所有内部绑定，再对照既有服务基线。成功后启用自己的两个 systemd 服务自启动和自己的日志轮转配置。

常用 Compose 命令（默认 Docker 命令禁止用于本项目变更）：

```bash
/data/dtwin/bin/docker-dtwin compose \
  --env-file /data/dtwin/config/.env \
  -f /data/dtwin/config/compose.yml ps
```

## 验收与回滚

必须验证登录/退出、非法来源拒绝、匿名权限、2D/3D 创建保存、静态模型/WASM、文件上传、签名下载及 Range、multipart worker 完成，以及两条 WebSocket。验收脚本只清理其审计记录拥有的临时项目。

```bash
DTWIN_ORIGIN=http://YOUR_SERVER:19080 \
DTWIN_ADMIN_FILE=/path/to/private/admin.json \
node deploy/server/verify.mjs
```

在服务器 loopback 检查时可额外指定 `DTWIN_CONNECT_ORIGIN=http://127.0.0.1:19080`，请求仍保留真实公开 Host/Origin；这只能证明服务链路，不能替代公网可达性验收。

接口与资源检查不会执行浏览器 JavaScript。2026-09-29 曾出现首页返回 200、但普通 HTTP 下 `crypto.randomUUID` 不可用而白屏的问题；UUID 现统一由 `crypto.getRandomValues` 生成。发布验收必须再使用真实非 localhost HTTP 浏览器，禁止通过安全上下文白名单或全局 polyfill 掩盖问题。使用已有 Playwright 和 Chrome，无需在服务器安装浏览器：

```bash
DTWIN_ORIGIN=http://YOUR_SERVER:19080 \
DTWIN_ADMIN_FILE=/path/to/private/admin.json \
DTWIN_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
DTWIN_BROWSER_CHANNEL=chrome \
node deploy/server/verify-browser.mjs
```

该脚本记录浏览器能力、页面错误、失败登录的中文原因与默认折叠详情、改正凭据后的成功登录，以及临时组件创建保存的证据；只删除本轮临时项目并撤销本轮会话，审计位于凭据文件同目录且权限 0600。截图和凭据均不得提交。模拟响应的 UI 测试不能替代真实服务的失败与成功登录验收。

仅前端升级时，将验证后的 `web/` 放入新的 release 目录，保留旧目录，备份受限 `.env` 并只更新 `RELEASE_DIR`；使用专用 wrapper 的 `compose ... up -d --no-deps nginx` 切换挂载。此变量只用于 Nginx 静态目录，后端镜像和数据不变。前端回滚同样只恢复此前的 `RELEASE_DIR` 并重建自己的 Nginx，随后重新验收；无需停止其他 DTwin 服务或公共 Docker。

当前发布 `dtwin-ui-20260929-errors-dcaquuqx` 的前端回滚目标为 `/data/dtwin/releases/dtwin-ui-20260929-http-uuid-365896d8`，保留普通 HTTP UUID 修复；原始完整 release 继续作为首次部署历史与后端构建记录保留。本轮审计目录为 `/data/dtwin/audit/error-notice-20260929-dcaquuqx`；各项验收须使用本轮证据，不把此前版本的通过结果当作当前版本已通过。

本机 TUN 影响外网连接时，可选设置 `DTWIN_LOCAL_ADDRESS` 为本机物理网卡当前已分配的 IP，例如本轮使用 en0 的当前 IP 进行真实公网验收。脚本会拒绝未分配给本机网卡的地址；此选项只绑定请求的本地源地址，目标仍是 `DTWIN_ORIGIN` 指定的真实公开地址，不改变 Host/Origin 或权限校验。公网验收时不要设置 `DTWIN_CONNECT_ORIGIN`，不能以 loopback 请求冒充外网验证。2026-09-29 默认路由（TUN）的普通 curl 首页请求也已返回 200，用户访问网站无需配置该验收选项。

首次整套部署启动或业务验收失败时，使用本项目 wrapper 对本项目 Compose 执行 `stop`，再停止本项目 Docker/containerd；保留 `/data/dtwin` 数据和失败日志。不删除卷，不修改既有服务。仅公网入口未连通、而本机验收正常时，应继续定位入口链路，不能据此重建数据库或重启其他服务。升级时保留旧 release，并在迁移前做 PostgreSQL 备份与对象存储备份；数据库迁移不能靠只切旧镜像来回滚。数据盘不是备份，自动异地备份未配置。
