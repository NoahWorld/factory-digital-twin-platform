# 2D + 3D 智能车间联动 Demo

创建日期：2026-09-10。该 Demo 使用本地 D1 项目数据和 `scripts/mock-device-server.mjs` 生成的模拟设备状态，所有运行详情均明确标记为“模拟数据”。

## 项目入口

- 3D 联动预览：`http://localhost:5173/#/projects/5b6f638b-dd36-49fe-9bb4-29f21eef1b3d/scene-preview`
- 3D 场景编辑：`http://localhost:5173/#/projects/5b6f638b-dd36-49fe-9bb4-29f21eef1b3d/scene`
- 完整 2D 看板：`http://localhost:5173/#/projects/86176c3e-fe9d-4b86-b705-0843c65d9dda/preview`
- 2D 画布编辑：`http://localhost:5173/#/projects/86176c3e-fe9d-4b86-b705-0843c65d9dda/canvas`

3D 项目复制自案例 `ae0ea21c-222c-4903-be37-8ab82064f4ee`，保留 98 个场景实例，并通过 `linked2dProjectId` 关联新的 2D 看板。场景和画布继续分别保存与版本化，设备联动只依赖共同的稳定 `assetId`。

## 设备绑定

| 场景实例 | assetId | 展示名称 | 模拟状态 |
| --- | --- | --- | --- |
| `workshop-056` | `DEMO-ROBOT-01` | 一号产线机械臂 | 运行 |
| `workshop-059` | `DEMO-ROBOT-02` | 二号产线机械臂 | 预警 |
| `workshop-067` | `DEMO-AGV-01` | 中央通道 AGV | 运行 |
| `workshop-068` | `DEMO-AGV-02` | 东侧通道 AGV | 停机 |
| `workshop-055` | `DEMO-MACHINE-01` | 一号产线自动设备 | 运行 |
| `workshop-093` | `DEMO-CABINET-01` | 动力控制柜 | 运行 |
| `workshop-074` | `DEMO-CAMERA-01` | 北墙生产监控 | 运行 |
| `workshop-073` | `DEMO-BEACON-01` | 入口三色报警灯 | 告警 |

模型点击和右侧设备列表反向选择共用同一个实例选择状态。选中已绑定设备后，2D 面板读取关联项目的运行态 API，展示状态、节拍、产量、温度、利用率等映射指标；打开完整 2D 看板时，通过 `?asset=<assetId>` 恢复同一设备详情。墙体、柱子、地坪、货架等未绑定的场景构件被点击时会明确提示没有业务资产，不会伪造设备数据。

## 本地运行

依次保持以下三个服务运行：

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:mock
```

本地 Worker 的 `apps/api/.dev.vars` 需要包含：

```dotenv
RUNTIME_POLLING_ENABLED=true
RUNTIME_ALLOWED_HOSTS=127.0.0.1:8790
```

模拟接口为 `http://127.0.0.1:8790/factory/demo-workshop`。详细安全边界、故障切换和恢复方式见 [本地 REST 设备联动测试](./local-rest-device-runtime-test.md)。

## 验收结果

- 3D 预览加载 98 个实例，右侧看板识别 8 台绑定设备。
- 8 台设备均能读取服务端标准化快照；预警、告警与停机状态进入异常汇总。
- 从设备列表选择机械臂后，3D 实例高亮且指标持续刷新。
- 从 3D 画布点击模型会更新相同的选择状态；未绑定构件显示明确提示。
- 完整 2D 看板通过 URL 资产参数显示同一设备的实时详情。

该 Demo 仍使用浏览器逐资产轮询和服务端即时采集，只用于本地竖切验证。集中采集、缓存、SSE/WebSocket 分发、历史时序和真实设备接入仍属于后端阶段。
