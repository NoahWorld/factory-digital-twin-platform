import { useState } from "react";
import { CanvasTemplateGallery } from "../canvas/CanvasTemplateGallery";
import { canvasTemplates, type CanvasTemplateId } from "../canvas/templates";

type TemplatesPageProps = {
  canCreateProject: boolean;
  onCreateFromTemplate: (templateId: CanvasTemplateId) => void;
};

export function TemplatesPage({
  canCreateProject,
  onCreateFromTemplate,
}: TemplatesPageProps) {
  const templateCategories = ["全部", ...new Set(canvasTemplates.map((template) => template.category))];
  const [activeCategory, setActiveCategory] = useState("全部");
  const visibleTemplateIds = canvasTemplates
    .filter((template) => activeCategory === "全部" || template.category === activeCategory)
    .map((template) => template.id);

  return (
    <section className="workspace-content templates-content" id="templates">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Industry template library</p>
          <h1>行业模板库</h1>
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
        <strong>以下均为虚构演示案例</strong>
        <span>企业、地点与数值为模拟内容，画布结构和组件均可实际编辑；首次保存后，项目列表会自动生成封面。</span>
      </div>

      <div className="template-category-toolbar">
        <div>
          <strong>场景分类</strong>
          <span>先筛选交付方向，再选择可编辑模板。</span>
        </div>
        <div aria-label="行业模板分类" className="template-category-actions" role="group">
          {templateCategories.map((category) => (
            <button
              aria-pressed={activeCategory === category}
              className={activeCategory === category ? "is-active" : undefined}
              key={category}
              onClick={() => setActiveCategory(category)}
              type="button"
            >
              {category}
              <span>
                {category === "全部"
                  ? canvasTemplates.length
                  : canvasTemplates.filter((template) => template.category === category).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <CanvasTemplateGallery
        actionLabel="用模板创建项目"
        className="template-page-gallery"
        editable={canCreateProject}
        onApply={onCreateFromTemplate}
        visibleTemplateIds={visibleTemplateIds}
      />
    </section>
  );
}
