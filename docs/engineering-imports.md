# BIM / CAD 工程底座

入口：资源库 → AI 场景底座 → 工程底座。前端负责文件选择、要求说明、图层配置和任务状态；Java 负责项目权限、源文件存储、持久化任务与模型入库；独立 Python 子进程负责几何转换。最终产物是普通项目 GLB 资源，复用既有预览和场景编辑器。

## 输入与输出约定（schemaVersion 1）

- BIM 接收 `.ifc`，使用 IfcOpenShell 读取已有三维几何、构件位置和材质颜色，保留构件标识。不接受原生 RVT；在建模工具中导出 IFC 后导入。引用的专业模型应先导出到该 IFC 中。
- CAD 接收 `.dxf`，在模型空间按真实尺寸绘制。DWG 请先导出 DXF，扫描图片和仅含标注的图纸无法恢复三维。原图层名称可以直接映射用途，不要求全部重命名。
- 平面图使用 XY 平面、Z=0。墙体必须是表示实际墙厚的闭合占地轮廓，地坪、柱和设备使用闭合轮廓；双线墙、中心线墙不会被自动猜测为实体。每个有内容的图层都须明确选择地坪、墙体、柱子、设备简化体或忽略。
- 单位明确选择毫米、厘米、米、英寸或英尺；有声明单位的 DXF 必须与选择一致。高度/厚度与基准标高始终以米填写，高度 `(0,1000]`，标高 `[-10000,10000]`。缺失或非法参数阻止生成。
- 支持闭合多段线（含圆弧）、圆、闭合椭圆、闭合样条、填充边界孔洞、嵌套/镜像/数组图块及受支持的三维网格实体，具体测试范围由后端转换器测试约束。3DFACE、MESH、polyface 和 polygon mesh 保留原生三维坐标，图层高度只用于二维轮廓；细分/拟合网格应先在 CAD 中转为实际面网格。外部参照必须绑定，代理实体须导出成支持的几何。设备按轮廓生成的是简化体，不包含真实内部机构或动画。
- 门洞/窗洞必须存在于 IFC 几何中，或通过明确 CAD 几何表达。二维平面图不能确定窗台、过梁或完整门窗构件，不自动补造。
- 单次源文件最多 100 MiB；输出 GLB 沿用现有 25 MiB 资源上限。大型 BIM 先按楼层/区域导出，超限会明确失败。单文件大小合规不等于已经通过浏览器场景复杂度预算。
- 输出统一米制、Y-up，保留稳定、唯一的构件/实体节点名及来源信息。居中是显式配置；源坐标偏移保留在转换摘要中。大坐标导致 GLB 浮点精度不足时明确失败并提示居中，不能把塌陷几何当作成功。GLB 是展示几何，不自动成为碰撞体、施工精度认证或完整 BIM 属性数据库。

上传前显示这些要求及样例下载。解析完成后配置生成参数；未映射图层、不支持的建模实体、无效轮廓、单位冲突均明确报错。明确忽略的图层会记录，禁止悄悄丢弃几何后报告完整成功。

### CAD 规范示例

前端提供的 `engineering-layout.dxf` 是原创 20 × 12 米车间平面图，坐标单位选择 **毫米**。建议使用以下配置并开启居中：

| 图层 | 用途 | 高度/厚度（米） | 基准标高（米） |
| --- | --- | --- | --- |
| DT_FLOOR | 地坪 | 0.2 | -0.2 |
| DT_WALL | 墙体 | 4 | 0 |
| DT_COLUMN | 柱子 | 4 | 0 |
| DT_EQUIPMENT | 设备简化体 | 1.5 | 0 |
| DT_IGNORE | 忽略 | 不适用 | 不适用 |

预期生成 12 个对象，居中后模型包围盒为 `[-10, 0, -6]` 到 `[10, 4.2, 6]`（米、Y-up）。墙体包含平面入口缺口，设备使用嵌套图块；该示例展示输入规范和尺寸验收，不代表任意图纸都能自动还原。

## 异步流程与接口

1. `GET /api/v1/engineering-imports/capabilities` 检查转换依赖，返回可用状态、格式及源文件限额。
2. `POST /api/v1/projects/{project}/engineering-imports` 上传 `multipart/form-data` 的 `file` 和 `name`，返回 `202 {import}`。源文件保存在对象存储，任务写入 PostgreSQL。
3. worker 解析源文件。`GET /api/v1/projects/{project}/engineering-imports/{id}` 返回阶段、实际进度、更新时间及解析报告。
4. `needs_configuration` 时，`POST /.../{id}/convert` 提交版本化参数，返回 `202 {import}`；再次入队，由 worker 转换、检验 GLB 并入库。
5. `completed` 返回 `resourceId`；`failed` 保留稳定错误码、受控诊断上下文和服务器日志。列表 `GET /.../engineering-imports` 用于关闭页面后的恢复。

打开面板先检查 capabilities，成功后再读取任务列表。能力接口返回 404 时表示当前后端缺少工程接口，显示一条紧凑的后端更新提示并暂停依赖请求，不能误报“内容不存在”。接口成功但 `available=false` 时明确提示转换依赖状态，已有任务仍可查看；任务接口自身的 404/403 或网络失败继续如实展示。

转换参数：

```json
{
  "schemaVersion": 1,
  "name": "一号车间",
  "units": "mm",
  "center": true,
  "layers": [
    {"name": "DT_FLOOR", "role": "floor", "height": 0.2, "base": -0.2},
    {"name": "DT_WALL", "role": "wall", "height": 6, "base": 0},
    {"name": "ANNOTATION", "role": "ignore", "height": 0, "base": 0}
  ]
}
```

IFC 使用文件单位和已有三维高度，图层数组为空。CAD 每个有效图层必须有且只有一项映射，最多 2,000 层，参数 JSON 不超过 2 MiB。转换预算为展开后最多 100,000 个实体、2,000,000 个三角面，最终仍受 25 MiB 输出限制。浏览器只展示审查过的错误说明以及图层、实体类型、句柄等定位信息，不展示服务器路径或原始异常。

任务有租约、心跳、进程超时和失败记录。页面不会等待一个长时间同步转换请求，也不使用虚构百分比。网络失败显示重试次数；重新连接后读取服务器状态，刷新页面不重建任务。

## 无外网部署

Python 不是额外常驻服务。后端镜像内包含 JRE、Node、Python 和固定版本、官方 SHA-256 校验锁定的 IfcOpenShell/ezdxf 等 wheel，运行时不执行 pip、npm、apt 或外网请求。API 与 worker 使用同一镜像。构建时默认使用官方 PyPI，也可通过 `--build-arg PIP_INDEX_URL=<可信索引>` 选择可达源；`--require-hashes` 始终校验锁中的哈希。

本机 Vite 热更新只更新前端，不能更新已经运行的 Java 容器。新增工程接口后须备份数据库、按既有本地部署流程更新 API/worker 运行镜像，并确认 V8 迁移成功；`/health` 正常只说明服务存活。验收须通过浏览器正在使用的地址，以有效登录读取 capabilities 和项目任务列表，确认依赖可用且页面正常。隔离冒烟测试通过不代表当前本机服务已经更新。

在有网络且与服务器目标架构一致的构建机准备：

```sh
# 在独立 factory-digital-twin-backend 仓库执行。
mvn -B clean verify
docker build -f Dockerfile.runtime -t dtwin/backend:engineering-v1 .
docker run --rm --network none --entrypoint python3 dtwin/backend:engineering-v1 \
  -m unittest discover -s /app/engineering -p 'test_*.py'
docker save -o backend-engineering-v1.tar dtwin/backend:engineering-v1
sha256sum backend-engineering-v1.tar > backend-engineering-v1.tar.sha256
```

在无外网服务器：

```sh
sha256sum -c backend-engineering-v1.tar.sha256
docker load -i backend-engineering-v1.tar
# 将 BACKEND_IMAGE 指向上面的镜像，并按既有发布流程更新前端静态资源与 API/worker。
# 已加载数据库、缓存、存储等依赖镜像后，使用 --pull never --no-build 启动。
```

Mac ARM 构建产物不能直接运行在 x86 服务器。使用目标架构构建机，或显式 `docker buildx build --platform linux/amd64 --load ...`，并在目标架构执行转换验收。首次完整离线部署还需携带 PostgreSQL、Valkey、对象存储、Nginx 镜像及前端静态包。

worker 默认内存上限 2 GiB、JVM 堆 384 MiB、临时空间 512 MiB；每个 worker 一次一个工程转换。按现场容量设置 `ENGINEERING_WORKER_MEMORY`。扩容不能替代文件/几何预算；超时、进程退出及 worker 重启必须作为可见任务状态处理。

非容器开发可设置 `TWIN_ENGINEERING_PYTHON` 和 `TWIN_ENGINEERING_WORKER` 的绝对路径。它们只允许由服务器环境配置，用户上传不能指定可执行程序或命令行。

## 验证入口

- 后端：`mvn -B clean verify`；Python：`python -m unittest discover -s engineering -p 'test_*.py'`。
- 前端：`pnpm check`、`pnpm build`、`pnpm test:scene-background`、`pnpm test:api-errors`。
- 前端参数/浏览器：`pnpm test:engineering`、`pnpm test:engineering:browser`（已安装 Playwright 与 Chrome；可设置 `PLAYWRIGHT_MODULE_PATH`）。
- 真实服务：将后端镜像标记为 `factory-twin-backend:engineering-test` 或设置 `ENGINEERING_TEST_IMAGE`，在平台执行 `pnpm backend:smoke:engineering`。脚本要求镜像已存在，以 `--pull never` 在隔离内网创建临时 PostgreSQL/Valkey/S3/API/worker，不读取既有凭据与数据；验证 IFC/DXF 实际转换、GLB 入库、任务重启恢复、权限边界及损坏文件失败，最后清理自己的容器和网络。测试 GLB 与结果保存于输出的临时目录。
- 后端 `engineering/make_fixtures.py` 生成原创无客户数据样例，`engineering/fixtures/options.json` 为 CAD 示例参数。自动样例不能代替客户真实复杂 BIM/CAD 的兼容性验收。

历史 Cloudflare Worker 不支持此服务，`apps/backend` 历史快照不参与构建。单图背景的旧 Worker 能力与工程转换是两条独立链路，Java 的单图生成迁移状态仍由 capabilities 如实表达。
