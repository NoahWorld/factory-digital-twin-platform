# WebSocket 数据源协议

Node运行服务使用固定版本ws 8.21.3，在服务器连接上游。浏览器继续使用同源、受项目权限保护的SSE标准状态，不直连客户WebSocket。连接可按需或持续运行，认证及有效端点沿用私有环境解析。

项目配置示例（只含逻辑引用）：

```json
{
  "sourceType": "websocket",
  "name": "设备实时数据",
  "config": {
    "url": "",
    "endpointRef": "equipment-gateway",
    "collectionMode": "demand",
    "credentialRef": null,
    "heartbeatSeconds": 30,
    "reconnectMaxSeconds": 60,
    "sampleIntervalMs": 100,
    "timestampPath": "$.timestamp",
    "topics": ["equipment"]
  }
}
```

topics可省略；存在时，每次连接后发送一次 `{"type":"subscribe","topics":["equipment"]}`，重连自动重发。上游应发送UTF-8 JSON完整源快照，字段通过已有资产指标映射解析；这不是任意客户私有订阅协议或增量补丁合并器。示例数据为 `{"timestamp":"2026-09-13T00:00:00Z","values":{"temperature":42,"status":"running"}}`；真实采样需当前时间，旧时间会明确陈旧。

每条消息最多256KiB，最多1024个分片/2048个缓冲块；不启用压缩，保留UTF-8校验。每秒最多1000条消息和4MiB正文；合法消息按采样间隔合并为最新样本，非法JSON、二进制、超限和私有信息原文回显明确失败。正常心跳使用匹配随机内容的ping/pong，错过下一周期即断开。握手和首样本测试最多10秒，重连从1秒退避到配置上限，重新连接本身不能使旧值恢复在线。

连接寿命不占用REST的六个握手/请求并发槽；任务代次取消会清理连接、心跳、待刷新样本与重连。诊断只记录项目、源、请求ID及错误码。WS/WSS只接受准确主机白名单，拒绝重定向；TLS沿用Node默认验证，不提供关闭证书验证开关。公司私有协议、证书环境及实际吞吐仍须现场验证。

实现参数参考对应版本的[ws官方API文档](https://raw.githubusercontent.com/websockets/ws/8.21.3/doc/ws.md)。独立构建内联ws，使用Node内置模块，不需要运行目录的node_modules或可选原生插件。类型定义版本与库版本不同，新增的分片边界以该固定库和实际协议测试为准。
