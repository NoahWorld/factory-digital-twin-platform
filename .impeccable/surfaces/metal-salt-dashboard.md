# 金属盐产线展示看板

- Mode: Operate
- Route: `#/projects/{项目ID}/metal-salt-dashboard`
- Implementation: `apps/web/src/dashboard/MetalSaltDashboard.tsx`
- Build path: code-led；现有体系普通扩展，无批准的图片 comp。
- Product context: `PRODUCT.md`；功能契约与验证记录：`docs/metal-salt-dashboard.md`。

## Direction contract

THESIS: 让参观人员通过真实三维车间理解七设备的工艺关系，并点击设备查看模拟参数；车间是页面主体。

OWN-WORLD: 沿用项目深蓝背景、蓝青强调、浅文字和绿色状态。矩形参数面板、细分隔线与等宽数字服务于快速读数；这些布局与局部颜色不构成全局主题变更。

STORY: 先辨认产线布局，再沿反应、清洗、分离、分散的固定工艺路径定位设备，最后查看详情与模拟趋势。模拟标识持续可见，已保存场景只读，登录和模型资源仍走 IoT / MinIO。

FIRST VIEWPORT: 16:9 桌面顶部居中标题“xxx金属盐看板”，中央真实三维车间，左三右四设备参数，底部工艺路径；模型下方放俯视、复位和暂停操作。窄屏将三维场景置于数据区上方，详情为可关闭、可滚动浮层。

FORM: 现有视觉体系的普通扩展，采用真实场景与两侧参数的用户指定布局；未运行世界替换或概念候选排名，不编造排名或种子引用。关键交互为模型、参数按钮、工艺路径共用设备选择状态；参数每两秒更新，暂停及页面隐藏时停止推进模拟。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Completion evidence

- 普通扩展按 new-work 规则核对 incumbent 并保留全局设计文件现状。对照 `theme/theme-palette.css`、`styles.css` 和看板 CSS，确认同属现有深蓝蓝青体系；未创建或重写全局 DESIGN.md / design.json。
- 本页面没有新增交付用位图；三维画面来自既有模型运行时，review 目录中的 PNG 仅为验收截图。
- 实施记录确认 `pnpm build` 通过；1920×1080、1280×720、390×844 的实际渲染及详情、暂停恢复、俯视复位、Escape 焦点返回已验证。
- 完成评审 disposition：`ship`。最后修复复核的桌面主体、全屏失败提示、720 高裁切均为 resolved；不将这三项结果扩大为未测路径保证。
- 全屏成功路径未验证；仅浏览器拒绝后的明确提示已验证。
- 文档复核实际查看 `desktop-1920.png` 与 `mobile-detail.png`，其余截图及验证范围见功能文档。全局 DESIGN.md / design.json 的既有缺失仅记录，未扩大本次写入范围。
