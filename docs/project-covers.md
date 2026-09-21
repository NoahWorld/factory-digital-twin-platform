# 项目实景封面

当前 Java/PostgreSQL 主链路使用浏览器对已保存项目进行真实截图。历史 Worker 后端不属于此实现。

## 生成与失效

- 项目创建、画布/场景保存后封面状态为 `pending`。修改名称不会使照片失效；项目名称只显示在卡片正文。
- 项目列表按顺序挂载一个不可交互的截图容器。只有管理员、项目 owner/editor 可以生成并上传，viewer 只读取缓存。
- 2D 使用正式 `CanvasSurface`；独立 3D 与嵌入场景共享 `standaloneRendererNode` 和 `Model3DNode`。沿用已保存的模型、材质、灯光、背景和视角，不额外拼装概念图。
- 所有子场景、图片与字体就绪后，注册的 WebGL surface 同帧渲染并捕获；仅在临时截图容器把 canvas 换为对应帧图片，再由 `modern-screenshot` 合成 960 × 540 PNG。不会改动用户编辑器的 DOM，不永久开启 `preserveDrawingBuffer`。
- 上传完成即卸载临时容器，释放渲染资源，卡片只显示缓存图片。返回列表会刷新状态，成功保存后再补拍，不截取未保存编辑状态。
- 3D 场景保存也会使同租户内引用该场景的 2D 封面失效。封面版本独立于文档版本，避免引用更新后旧截图回写。
- 生成失败显示具体项目、错误和重试按钮；重试会重新读取版本。没有截图时显示“尚未生成项目截图”，已有有效截图时更新期间保留旧截图。禁止使用概念图掩盖模型、资源或 WebGL 错误。
- V3 迁移清除历史概念 SVG。已有项目会在有写权限的用户访问列表时逐个补拍；服务端不依赖无头浏览器。

## API 与存储

项目返回 `documentRevision`、`coverRevision`、`coverSourceRevision`、`coverStatus`、`coverUrl`。

- `PUT /api/v1/projects/{id}/cover?sourceRevision=N&expectedCoverRevision=M`：原始 `image/png`，需要项目写权限，同时校验两个版本；冲突返回 409。只接受 960 × 540、最多 2 MiB 的有效 PNG。
- `GET /api/v1/projects/{id}/cover.png`：需要项目读权限，私有 ETag 缓存；不存在截图时返回 404。
- 二进制独立存入 PostgreSQL `project_covers`，不写入文档 JSON、Base64、公开对象存储或模型资源。

## 验证

前端执行 `pnpm --filter @factory-twin/web check`、`pnpm test:scene-runtime`、`pnpm test:project-covers` 与构建；Java 执行 Maven verify。启动新版 API 后执行 `node scripts/backend-cover-smoke.mjs` 检查版本、权限、PNG 验证、ETag 与引用场景失效，并在浏览器核对真实 2D/3D 封面。
