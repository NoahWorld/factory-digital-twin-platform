# 硝酸银车间原生看板示例

本目录只保存原生文档组装代码和生成清单，不携带 IoT 项目 ID、现场照片或私有资源。设备外形、尺寸、管线及参数均为示意，不是实测模型或工艺设计。

1. 在仓库根目录运行 `node scripts/generate-silver-workshop.mjs`，生成设备、带动画的搅拌部件和化工车间 GLB。生成器会重新加载并检查每个文件。
2. 通过当前平台资源库上传 GLB，在自己的项目中取得模型资源 ID。
3. `author.ts` 的 `composeScene(assetIds, withActions)` 返回实例与流体定义；`composeCanvas(sceneId)` 返回原生 2D 看板节点和主题。调用方负责使用已有 API、权限和 revision 保存，函数不会自行创建或修改项目。
4. `assetIds` 需要 `neutral`、`evaporator`、`crystallizer`、`separator`、`condenser`、`collector`、`pump`、`workshop`。先保存场景，再把其项目 ID 传给画布；设备点击通过原生 `set-text` 动作更新信息卡。

仅调整车间时运行 `node scripts/generate-silver-workshop.mjs --workshop-only`；此模式必须已有生成文件及清单，会校验并保留设备内容。GLB 在本机生成，不自动纳入版本管理或发布到服务端。演示数值均有模拟标识，设备证据说明保留参考与待补拍边界。
