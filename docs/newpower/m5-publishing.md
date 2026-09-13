# M5 发布隔离与独立交付

承接M6a的Node宿主和集中采集。先实现冻结版本→运行固定版本→修改草稿不影响运行→发布新版和回滚，再让导入导出使用同一正式快照。现有project_versions只是早期表结构，没有可用发布流程。

## 冻结契约

RuntimeProjectSnapshot必须同时包含项目定义（页面、场景、组件绑定、交互、动画）、资产台账、资产指标映射、逻辑数据源和所引用资源的不可变版本/大小/SHA256/检查报告。只保存ProjectDefinition不够：资产、源和指标仍在可变表，当前collector也从这些表构造计划。

增加涵盖完整运行配置的修订计数。所有相关表变更在同事务推进，发布以该计数做最终CAS，避免读取多表期间产生混合版本；现有画布revision不能代替这个计数。冻结版本和当前生效指针分开，版本内容不可变，激活/回滚使用指针CAS并保留旧版本。

运行路由从固定releaseId读取定义、catalog和采集计划。采集身份包含发布版本或完整配置指纹，不能只按项目/sourceId和草稿共享。已有Canvas、Scene、Interaction执行器继续复用，不再从运行路由拉取草稿定义或映射。固定运行客户端保持该版本；用户打开当前发布入口时解析当前指针，切换行为明确可验证。

## 资源与包

建立发布版本资源引用，校验文件真实存在、字节数和SHA256。数据库中有资源行不证明文件可用。保留回滚版本引用；单资源删除若以后开放，必须同时检查草稿和全部保留版本。

导入复用快照校验和资源检查，不直接上传后丢掉新ID映射。模型报告的对象/clip身份与实际文件locator必须验证，包内资源及交互引用须保留或完整重映射。归档路径不直接用作落盘路径，条目、总字节、单文件和解压量都有边界；资源暂存验证完毕再提交项目/版本。

项目包不含用户、会话、运行数据库、Bootstrap、sources文件或实际认证头。运行连接使用endpointRef；旧直接URL在打包时显式转为逻辑引用，并输出待配置端点，不能静默删掉依赖。新项目的私有环境授权需要按其实际ID配置，不扩大其他项目权限。

## 首项闭环

1. 用已有双设备、多页、三维和动画项目发布V1，实际运行固定版本。
2. 改草稿布局、指标映射和数据源，确认V1不变。
3. 发布/激活V2，再回滚V1，检查权限和并发冲突。
4. 缺失或损坏必要文件时，明确拒绝激活。
5. 基于同一V1快照导出并在干净目录导入，仅靠打包宿主运行；停止编辑服务后继续工作。
6. 安装V2再回滚，核对私有环境不在包中、旧项目兼容和身份/引用完整性。

主要入口：apps/api/src/index.ts、project-definitions.ts、model-assets.ts、image-assets.ts、data-sources.ts；共享project-definition.ts和editor-operations.ts；apps/runtime/src/collector.ts及Node宿主。M5完成后继续M6b，不关闭完整目标。

## 首项实现契约

0017增加完整运行配置修订、不可变project_versions内容、当前发布指针和版本资源外键引用。34个数据库触发器使资产/映射/源/页面/场景/报告变化在原事务内推进完整修订；失败事务同时回滚计数。D1的meta.changes包含触发器更新，API适配层改为同一batch内读取SQLite changes()作为直接修改行数，保留原CAS判定；Node原生适配已具备直接changes。

`GET /publication-draft`实际读取资源并校验完整快照，返回用于冻结的runtimeRevision。`POST /versions`以expectedRuntimeRevision创建冻结内容；`POST /versions/:versionId/activate`以expectedPublicationRevision切换当前指针，0表示首次。激活重验资源文件和实际数据连接/类型/陈旧状态，失败不改变当前指针。操作继承请求取消，停机/断开后不继续激活。冻结版本可以在数据上游失联时留存，但必须通过激活检查才成为当前发布版本。

`#/projects/:projectId/run`解析当前指针后进入固定`/versions/:versionId/run`；固定页面不会因随后激活变化偷偷切换。页面定义、catalog、模型报告和采集计划来自完整冻结快照，源任务身份包含versionId。当前发布的持续源在无人查看及重启后恢复；旧固定页面尚有订阅时保留其版本任务，最后退出按需求释放。草稿与发布配置分别采集，不以sourceId相同推定可共享。

旧模型的名称覆盖与资产绑定，使用同版Three GLTFLoader的真实运行名称→文件locator清单；服务端省略纹理像素载入以保持无DOM，无外部资源请求。与实际浏览器的sanitize名称和多primitive定位对照验证，按页面/视窗检查旧资产多重匹配。运行快照metadata预算8MiB，文件仍按模型25MiB/图片8MiB受控。导出阶段要将直接URL显式外部化为逻辑端点；该包流程现已按下列契约实现并验证。

## 项目包与程序交付（本机验收通过）

项目ZIP导出不可变版本，包含manifest.json及该版本引用的模型/图片；模型祖先版本随包保留。直接URL转成逻辑endpointRef并列出待配置端点，私有环境文件不进包。shared/project-package.ts统一格式校验与正式身份重映射，业务assetId、对象/clip和项目内稳定ID保持不变。上限512MiB、2001条目，模型25MiB、图片8MiB；未知结构、重复路径、目录/链接/加密条目、CRC/实际解压量/SHA与报告不符均拒绝。

Node先检查并暂存，界面展示内容和环境依赖，再安装。新项目得到冻结版本和空草稿；同目标升级复用已确认的来源身份，增加版本而不覆盖草稿/当前指针。安装ID幂等，已安装暂存可清理后继续读回回执；来源版本或资源ID被复用为不同内容会冲突。恢复为可编辑草稿另有数量预览、完整runtimeRevision CAS、事务审计和单独确认，canvas revision单调推进，资源与历史版本保留。

安装在写资源前原子保存journal。SIGKILL实测后，重启只回收无数据库引用的本次对象，保留已提交对象；不确定时保留恢复记录。安装、丢弃、清理在第一个异步点前取得同inspection独占锁，避免检查单被并发移除。独立SQLite锁保证一个data目录仅一宿主。安装/恢复/发布最终SQL检查当前用户权限，预检查通过不代替提交时权限。

导入面板可下载独立程序ZIP，含server.mjs、public、migrations、实际打包依赖许可、初始化工具和macOS/Linux/Windows启动脚本。默认只监听本机，启动创建随机私有环境文件；管理员密码通过本地私有文件读取，无默认口令。Node24.18+的干净目录启动、真实项目导入、停止源宿主后运行及HTTPS同源代理已经验证。Windows脚本未在Windows执行，本机无Docker；真实客户环境仍需现场验收。具体使用见[独立交付说明](project-delivery.md)。

ZIP实现依据：[fflate 0.8.3](https://github.com/101arrowz/fflate/tree/v0.8.3)、[yauzl](https://github.com/thejoshwolfe/yauzl)；实际锁定fflate0.8.3/yauzl3.4.0，使用安装源码确认API。浏览器与无DOM检查共用Three0.185.1；Buffer视图必须精确复制，不能以slice().buffer假定边界正确。
