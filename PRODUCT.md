# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

数字孪生交付人员搭建场景与看板；产线甲方、参观人员通过金属盐展示看板了解设备和工序。

## Product Purpose

在 IoT 中组合可交互三维车间与设备数据，支持产线展示及设备详情查看。

## Capabilities and Constraints

- `iot-3d` 复用 IoT 登录、后端和 MinIO，保持独立前端构建，不升级 IoT。
- 金属盐展示看板复用已保存的七设备直角产线及车间场景，标题为“xxx金属盐看板”。
- 用户确认 16:9 大屏、两侧模拟设备参数、点击设备查看详情、科技风格。
- 当前展示参数由独立模拟配置生成，必须明确标识，不能冒充 IoT 实时测量或生产业绩。
- 实际厂名、工艺设定与现场设备点位尚未提供。

## Evidence on Hand

已保存的 IoT 车间场景，以及 demo-assets/separation-line 中的布局记录和截图。
