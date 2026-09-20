# 流体 3D 行业案例 · 初版记录

> 原项目已升级至 [第二版](../fluid-cases-v2/README.md)，入口保持不变。以下内容是初版历史记录；维护当前案例请使用第二版更新器，不要重新运行初版导入以覆盖新版。

2026-09-18 已通过正式 API 保存到本地 Java 平台：3 个独立 3D 项目、3 个配套 2D 工艺看板、16 个 GLB 模型资源、13 台业务设备、3 个模拟数据源、57 条指标映射。项目名称统一以「行业案例｜」开头。项目与资产配置保存于 PostgreSQL，GLB 文件保存于私有 SeaweedFS/S3，数据库持有资源记录及引用。

| 案例 | 完整工艺范围 | 主要流体效果 | 入口 |
| --- | --- | --- | --- |
| 钢水浇注与连铸 | 钢包 → 中间包 → 结晶器 → 二冷喷淋 → 铸坯；配冷却水辅助站 | 发光钢水流束、冲击飞溅、液面波动、喷淋 | [3D 场景](http://127.0.0.1:5173/#/projects/3fc3b7c3-336a-498f-b8bd-537dc18bc94d/scene-preview) · [工艺看板](http://127.0.0.1:5173/#/projects/4525dd2b-0330-48be-af09-99888d9fcffa/preview) |
| 污水处理与中水回用 | 格栅进水 → 生化曝气 → 二沉分离 → 消毒回用；配污泥回流 | 曝气气泡、扰动液面、溢流、透明池体与流向示踪 | [3D 场景](http://127.0.0.1:5173/#/projects/53eca60c-e227-4031-9383-cc10da7feac9/scene-preview) · [工艺看板](http://127.0.0.1:5173/#/projects/ea3afa05-d4a1-4ff9-97ba-3c40369776b1/preview) |
| 工业循环冷却水站 | 冷却塔 → 循环泵 → 换热器 → 回水；配补水加药 | 塔内喷淋与水膜、集水盘波纹、管道示踪、冷热双回路 | [3D 场景](http://127.0.0.1:5173/#/projects/1d14ca33-1ddc-4d88-98be-d7771b1399db/scene-preview) · [工艺看板](http://127.0.0.1:5173/#/projects/cbdf45f0-620c-4345-8bb6-38af57a34697/preview) |

## 查看方式

启动本地平台并登录，打开上述入口或在项目列表搜索「行业案例」。可旋转、缩放模型；在独立 3D 预览中点击设备或右侧列表，查看对应模拟指标与选中高亮。2D 看板提供全流程、工况示例与流体观察点。

这些模型用于证明浏览器端的流体视觉表现与业务数据绑定能力。模型包含标准 glTF morph、平移、旋转和缩放动画，12 秒循环，无嵌入脚本；平台沿用现有 Three.js 运行层。它们不是 CFD 求解、工程设计校核或真实工厂数据。几何比例和工艺简化用于展示；动画时钟与模拟指标独立运行，未宣称水力/热力守恒或数据驱动液面。看板固定卡片、曲线标为示例数据，设备详情为明确标注的动态模拟采集。

## 生成、入库和运行

仓库根目录执行，要求已初始化本地 Java 后端及管理员，前端运行于 5173，后端运行于 18080：

```bash
# 已生成的 GLB 可以直接使用；需要重新制作才运行生成器。
node scripts/generate-fluid-cases.mjs

# 可选演示源独立容器，不修改原平台服务。
docker compose -f deploy/local/fluid-demo.yml up -d --wait

# 正式 API 新增项目/资源/资产/映射，再读取核验。
node scripts/import-fluid-cases.mjs

# 只核验已有数据和模型，不改项目。
node scripts/import-fluid-cases.mjs --verify-only
```

模拟源使用已安装的 `nodered/node-red:5.0.6-debian` 镜像中的 Node 运行时，入口是本仓库脚本，不运行 Node-RED。端口仅映射到本机 `127.0.0.1:8790`，容器随 Docker 重启恢复。后端现有 `RUNTIME_ALLOWED_ORIGINS` 必须包含 `http://host.docker.internal:8790`。三个来源为 `/fluid/steel`、`/fluid/water`、`/fluid/cooling`，每 2 秒采集、10 秒判陈旧。查看状态与日志：

```bash
docker compose -f deploy/local/fluid-demo.yml ps
docker compose -f deploy/local/fluid-demo.yml logs --tail=30
```

这与 `pnpm dev:mock` 共用 8790，不能同时启动。停止模拟源后，模型动画仍可播放，但运行态必须如实显示失联/陈旧。切回原 mock 前，可显式执行 `docker compose -f deploy/local/fluid-demo.yml down`。

导入日志在忽略提交的 `deploy/local/.local/fluid-cases-v1.json`，记录项目、资源、资产、映射及版本。再次执行会跳过已完成写入并重新核验。已存在同名项目但没有日志、生成清单变更、哈希不符或 API 错误都会中止；不覆盖其他项目或静默重建。复制到另一套平台需使用该平台自己的导入日志和身份；不要复制本机日志冒充已导入。

## 验收证据

`manifest.json` 保存模型哈希、尺寸、动画与模块说明，`local-projects.json` 保存本次实际入口。`qa/verification.json` 和截图记录实际浏览器验收。

```bash
# 需本机已安装 Playwright 及对应 Chromium；可指定绝对路径。
PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/path/to/chromium \
node scripts/verify-fluid-cases.mjs
```

验证包括：16 个模型加载与有限坐标、动画确实变动、12 秒循环无跳变、模型对象存储下载 SHA-256 一致、3 组设备采集有效、6 个场景/看板页面无脚本错误、设备列表选择和模拟数据标识。浏览器截图间的变化验证播放，不作为帧率基准。

| 案例 | 实际渲染网格数 | 三角形数 |
| --- | ---: | ---: |
| 钢水浇注与连铸 | 154 | 42,859 |
| 污水处理与中水回用 | 167 | 56,782 |
| 工业循环冷却水站 | 232 | 53,825 |

模型与动画由本仓库代码原创生成。英文标牌的轮廓字体取自 Three.js r185 的 Helvetiker；原始字体和 MAGENTA 许可见 `scripts/fluid-assets/`。模型无外部纹理、字体或网络资源依赖。
