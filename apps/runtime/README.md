# NewPower 本地运行宿主

Node.js 24.18+（24 系列），复用现有 API、项目 schema、权限和模型检查。SQLite 保存配置，本地文件存储实现原有 ObjectBucket 接口；静态前端和 API 同源服务。当前支持按需或持续集中 REST 采集；多个客户端按源共享任务，通过同源 SSE 读取标准状态。按需源最后订阅释放后停止，持续源在无人查看及重启后仍采样，故障和陈旧明确显示。支持环境逻辑端点与凭据，上游WebSocket支持服务器鉴权、心跳、主题订阅恢复和有界采样；协议见仓库docs/newpower/websocket-sources.md。

在仓库根目录执行 `pnpm build`，产物位于 `apps/runtime/dist`。该目录包含服务器、迁移和前端，可以复制到独立目录；运行时仅需匹配版本的 Node，不依赖 Vite、Wrangler、源码目录或 node_modules。完整发布/项目打包与回滚仍归 M5。

```sh
node server.mjs --data-dir ./data --config ./runtime.env --port 8792
```

默认仅监听 `127.0.0.1`。`runtime.env` 参考本目录的 `.env.example`，与项目配置/资源包分离。首次初始化需提供自选 `BOOTSTRAP_TOKEN`，没有默认账户或密码；已有账户无需再次初始化。白名单使用精确 `host:port`，本地 mock 为 `127.0.0.1:8790`。

配置库迁移沿用 `apps/api/migrations`，产物携带对应 SQL 和校验历史。初次创建新库；后续有迁移时先在线备份并检查完整性，成功后才执行事务。未知/漂移的迁移历史、失败备份、SQL错误或外键问题均阻止升级。不会自动重置或重放未跟踪的旧数据库；现有 Worker 验收库继续保留。

SQLite 批次使用原子事务、准确 changes 和外键。当前 Node 24.18 尚没有 StatementSync.close，适配器限制保留的预编译语句数量，并在关闭时释放数据库连接。SQLite 原生模块在 Node 24 文档中标为 release candidate，当前方法均以本机 24.18 实测为准，未直接照用较新文档新增接口。参考[Node 24 官方 SQLite 文档](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md)。

环境端点通过 `SOURCE_ENVIRONMENT_FILE`（相对runtime.env）或 `--sources` 指定私有JSON，参考 `sources.example.json`。在数据源表单填写“环境端点引用”，地址留空；服务器按引用解析实际URL，并要求当前项目ID明确列于该端点的projectIds，仍检查精确host:port白名单。凭据只能用于绑定的逻辑端点，不能携带到任意直接URL；服务启动时载入，修改文件后需重启。文件不得放在public或项目导出包内。REST和WebSocket均复用该环境解析。

运行/测试响应拒绝上游回显已配置的凭据或逻辑端点实际地址，错误只报告代码；原始上游内容不记日志。普通查看者的数据源列表隐藏直接URL、凭据引用及时间戳路径；旧编辑配置仍支持直接URL，实际内网交付应切换逻辑端点。

发布面板可以检查已保存配置、冻结版本并激活或回滚。`#/projects/:projectId/run`打开当前发布指针；进入后固定版本，草稿和后续激活不改变已打开页面。发布持续源独立于草稿，在重启时恢复；激活前需要资源完整和数据连通/映射有效。完整项目包导入导出仍在M5下一项。

MQTT设备消息由服务端连接，项目配置必填endpointRef、精确topic和timestampPath。私有sources.json的mqttEndpoints同时授权项目ID和topic，mqttCredentials保存用户名/密码，不使用HTTP headers。参见sources.example.json；host:port仍须列入RUNTIME_ALLOWED_HOSTS。支持MQTT3.1.1的QoS0/1和mqtt/mqtts，拒绝未经请求的QoS2以避免未确认消息存储无界增长；TLS证书必须可信，不提供跳过验证开关。每条消息为完整UTF-8 JSON快照，retained消息保留源时间并按真实新鲜度判断。消息上限256KiB，协议累积前有包与速率预算。

SQLite只读查询在私有sqliteQueries中登记queryRef对应的项目、databasePath、固定单条SQL、位置参数parameters、tables表列白名单和maxRows（1–1000）。相对路径以私有环境JSON目录为基准，不能指向本宿主data目录或其配置/遥测库硬链接。只读取常规表和受同一底层表列授权的视图，拒绝虚表及shadow tables。项目API只保存queryRef和轮询/超时/映射，SQL和实际路径不进入项目包。

结果默认是rows数组；设置rowKey列后返回records对象，键必须是唯一的设备编号格式字符串。建议多设备查询使用rowKey，例如$.records.DEVICE-001.temperature，避免行删除后索引移动错配。空结果分别是空rows或records；NULL保留，大整数超出安全范围、BLOB、重复列/键及超量结果明确失败。需要完整大整数时请在登记SQL中显式CAST AS TEXT并映射为文本。

独立sqlite-query-worker.mjs随程序包分发。每次查询独立进程，以只读/禁扩展/默认拒绝的authorizer执行；SQLite原生堆64MiB、Node堆64MiB、结果256KiB、最多128列，全宿主最多6个查询进程，总超时500–5000毫秒包含启动/文件检查/执行。timeout和取消杀进程并等待退出，SQLite busy timeout仅处理锁等待。输入禁止NUL，SQL尾部只能是空白（不接受第二条语句或尾随注释），不开放任意PRAGMA/写入/ATTACH或未列入白名单的函数。只读WAL读取仍依赖SQLite现场文件权限，不将数据库当作immutable忽略WAL。

模型版本支持Meshopt精确缓冲压缩：GET/POST /api/v1/projects/:projectId/model-assets/:assetId/optimize（POST空对象），仅编辑者可生成；UI在“模型版本与替换”提供入口。独立model-compression-worker.mjs随运行包分发，单任务/30秒/25MiB输出上限，原资源与对象、动画ID保留；生成版本不会自动替换或激活项目。报告显示实际大小，属性/索引不量化或重排。未知扩展拒绝生成，U8索引等不适合压缩的视图原样保留。Worker未提供此能力时明确返回503。
