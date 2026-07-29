import { CanvasTemplateGallery } from "../canvas/CanvasTemplateGallery";
import type { CanvasTemplateId } from "../canvas/templates";

type TemplatesPageProps = {
  canCreateProject: boolean;
  onCreateFromTemplate: (templateId: CanvasTemplateId) => void;
};

export function TemplatesPage({
  canCreateProject,
  onCreateFromTemplate,
}: TemplatesPageProps) {
  return (
    <section className="workspace-content templates-content" id="templates">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dashboard templates</p>
          <h1>大屏模板</h1>
          <p>选择行业大屏骨架，创建一个全新项目后继续编辑。</p>
        </div>
      </div>

      <div className="template-page-create-note">
        <div>
          <strong>模板用于创建新项目</strong>
          <span>选择模板后先填写项目名称，系统会创建新草稿并载入模板，不会覆盖已有项目。</span>
        </div>
      </div>

      {!canCreateProject ? (
        <section className="state-card template-permission-note">
          <h2>当前账号不能创建项目</h2>
          <p>你仍可浏览模板；需要由平台管理员或交付经理创建新项目。</p>
        </section>
      ) : null}

      <div className="template-dialog-notice template-page-notice">
        <strong>模板数据均为示例</strong>
        <span>进入新项目画布后可编辑所有组件；首次保存画布后，项目列表会自动生成封面。</span>
      </div>

      <CanvasTemplateGallery
        actionLabel="用模板创建项目"
        className="template-page-gallery"
        editable={canCreateProject}
        onApply={onCreateFromTemplate}
      />
    </section>
  );
}
