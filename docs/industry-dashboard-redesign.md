# 行业看板视觉改版

## 内容与编辑方式

2026-09-24 按制造、仓储、能源、园区四张用户视觉参考改版。四个原有模板 ID 保持不变，新增项目使用完整的 1920 × 1080 布局：

| 场景 | 配色 | 中央视图 | 原生节点数 |
| --- | --- | --- | --- |
| 工业制造 | 翡翠绿 | 机器人、加工设备、输送和包装产线 | 31 |
| 仓储物流 | 蓝紫 | 立体货架、AGV、车辆与物流路线 | 33 |
| 能源管理 | 琥珀金 | 输入、转换与车间用能流向 | 46 |
| 园区运营 | 冰蓝 | 园区鸟瞰、楼宇与停车标注 | 33 |

模板实现位于 `apps/web/src/canvas/industry-templates.ts`，由现有 `templates.ts` 注册。指标、趋势、排行、状态、工单表格、告警和场景标注均是原生画布节点，可分别编辑。中心画面是一个可替换图片组件；图中设备为固定视角美术素材，不提供几何拾取或三维旋转。能源流向使用代码绘制的 SVG 连线，文字和数值另用原生组件覆盖。

宣传页、登录展示、模板库缩略图、放大预览、模板创建均使用相同节点定义和正式渲染组件。画布节点的类型样式统一使用 `dashboard-kind-*` 外层类，避免与内部排行、表格等布局类同名而破坏排布。套用园区模板时继续保留用户已有的模型配置。已有项目不自动覆盖，需通过模板功能显式套用。

不展示“虚构演示”标签。模板数据保留示例来源属性，未接入实时业务接口。

## 图片来源与生成记录

三张 PNG 使用 ImageGen 工具 **从文字生成新图**，没有把用户的完整看板截图嵌入网页。用户图片仅用于确定配色、构图和内容方向。生成时禁止文字、图表、标签及 UI；最终标题和业务信息由代码渲染。

共同提示词：

> Use case: stylized-concept. Asset type: central scene artwork within an editable industrial dashboard. Create one finished landscape 1536 x 1024 image. Absolutely NO text, labels, letters, numbers, chart, dashboard frame, title, logos, watermark, badges, icons or callout pins. Only a coherent, richly modeled scene. This will occupy only the central view; all actual dashboard data and interface will be built separately in code.

场景提示词内容：

- **production**：两条 U 形输送线、六个玻璃罩 CNC 单元、黄色机械臂、检测与包装工位及托盘。白色、青绿和铝金属材质，青色边缘光，深绿 `#031b1b` 背景，丰富且连贯的等距工业场景。
- **logistics**：收货卡车在左下、立体货架在左上、储区在上部、分拣在右上、三辆 AGV 在下部中央、发货卡车在右下。蓝、紫、青的物流路线，靛蓝 `#080c24` 背景。
- **park**：蓝调傍晚的工业园鸟瞰；后部两栋玻璃研发楼、中央厂房、右侧仓库，前部有变电设施、行政楼、停车和景观。深蓝 `#04162d` 背景。

工具原始输出文件（生成目录在本次 Codex 会话的 `generated_images` 下）：

| 原始文件 | 项目文件 |
| --- | --- |
| `exec-16e3a156-4fd2-4332-aeab-d14073cf1cae.png` | `apps/web/public/images/industry/production-v1.png` |
| `exec-2caf05f9-370a-4b13-893e-394c8152f677.png` | `apps/web/public/images/industry/logistics-v1.png` |
| `exec-79efcdd0-8f40-46fb-a926-e7b760fe4a35.png` | `apps/web/public/images/industry/park-v1.png` |

`energy-flow-v1.svg` 是项目内编写的矢量网格与流向连线，不含外部引用。

## 资源与接口

`shared/builtin-images.ts` 是资源白名单唯一来源，记录固定 ID、内容路径、字节数和 SHA-256。画布仅保存 `resourceRefs`，不保存文件路径或图片二进制。Java 通过 `scripts/backend-contracts.mjs` 生成 `builtin-images.json`，历史 Worker 同样使用精确白名单。

内置图片属于公开静态美术素材，宣传页加载无需请求业务数据。项目列表/资源接口仍检查项目访问权限；内置资源禁止删除。未知内置 ID 和模型/图片类型混用必须失败。公开项目只返回当前文档引用的资源，撤销发布后原分享令牌失效。用户上传限制不变：只允许 PNG/JPEG/WebP，最大 8 MiB，检查扩展名及文件签名，不支持上传 SVG。

## 验证

- `pnpm test:canvas-templates`：8 个模板的结构、边界、原生组件、保存读取、模型配置保留及图片哈希。
- `pnpm backend:contracts:check`、`pnpm backend:verify`：生成契约一致性和 Java 测试。
- `pnpm backend:smoke`：本地 PostgreSQL/API 的 8 个真实模板保存与重新读取，内置图片列表、内容、不可删除、未授权读取、错误类型、公开资源范围和撤销发布。
- `pnpm test:resources`、`pnpm test:ui-theme`、`pnpm check`、`pnpm build`。
- 浏览器逐套检查宣传页放大画面、行业切换、场景加载、文字排布，再检查模板库创建及编辑器保存。

2026-09-24 验收结果：上述结构、资源、主题、类型检查和构建通过；Java 84 项测试通过，本地后端集成 31 组通过。浏览器检查四套宣传画面、模板库缩略图与分类；从制造模板创建临时项目，将“今日产量”由 12,680 改为 12,700，保存并刷新后保留修改，场景图正常加载。

模板库按实际产品流程为每套模板创建独立草稿进行保存验证。既有单次补丁 100 个增删项限制保持不变；对已有大量节点的画布整套替换，仍由编辑器预检并明确提示。

本地验收仅使用自行创建的临时项目，完成后按精确 ID 清理，保留已有项目与账号。
