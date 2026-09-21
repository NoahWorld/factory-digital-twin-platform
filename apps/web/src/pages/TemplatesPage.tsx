import { useState, type KeyboardEvent } from "react";
import { CanvasTemplateGallery } from "../canvas/CanvasTemplateGallery";
import { canvasTemplates } from "../canvas/templates";
import { SceneTemplateGallery } from "../scene/SceneTemplateGallery";
import { sceneTemplates, type ProjectTemplate } from "../scene/scene-templates";

type TemplatesPageProps = {
  canCreateProject: boolean;
  onCreateFromTemplate: (template: ProjectTemplate) => void;
};

export function TemplatesPage({
  canCreateProject,
  onCreateFromTemplate,
}: TemplatesPageProps) {
  const templateCategories = ["全部", ...new Set(canvasTemplates.map((template) => template.category))];
  const [activeCategory, setActiveCategory] = useState("全部");
  const [projectType, setProjectType] = useState<"2d" | "3d">("2d");
  const changeTabWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const type = event.key === "ArrowLeft" || event.key === "Home" ? "2d" : event.key === "ArrowRight" || event.key === "End" ? "3d" : null;
    if (!type) return;
    event.preventDefault();
    setProjectType(type);
    document.getElementById(`template-kind-${type}`)?.focus();
  };
  const visibleTemplateIds = canvasTemplates
    .filter((template) => activeCategory === "全部" || template.category === activeCategory)
    .map((template) => template.id);

  return (
    <section className="workspace-content templates-content" id="templates">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Industry template library</p>
          <h1>行业模板库</h1>
          <p>选择 2D 看板或 3D 场景模板，创建新项目后继续编辑。</p>
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
        <span>企业、地点、数值及动画均为模拟内容；模板可继续编辑，保存后生成真实项目截图封面。</span>
      </div>

      <div aria-label="模板类型" className="template-kind-tabs" role="tablist">
        {(["2d", "3d"] as const).map((type) => <button
          aria-controls={`template-panel-${type}`} aria-selected={projectType === type}
          id={`template-kind-${type}`} key={type} onClick={() => setProjectType(type)}
          onKeyDown={changeTabWithKeyboard} role="tab" tabIndex={projectType === type ? 0 : -1} type="button"
        >{type === "2d" ? `2D 看板模板 · ${canvasTemplates.length}` : `3D 场景模板 · ${sceneTemplates.length}`}</button>)}
      </div>

      <div aria-labelledby="template-kind-2d" hidden={projectType !== "2d"} id="template-panel-2d" role="tabpanel">
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
        onApply={(id) => onCreateFromTemplate({ projectType: "2d", id })}
        visibleTemplateIds={visibleTemplateIds}
      />
      </div>
      <div aria-labelledby="template-kind-3d" hidden={projectType !== "3d"} id="template-panel-3d" role="tabpanel">
        <SceneTemplateGallery editable={canCreateProject} onApply={(id) => onCreateFromTemplate({ projectType: "3d", id })} actionLabel="用模板创建 3D 项目" />
      </div>
    </section>
  );
}
