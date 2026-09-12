import { useEffect, useState } from "react";
import type { ProjectDefinition } from "../../../../shared/project-definition";
import type { ProjectOperation } from "../../../../shared/project-operations";

export function ProjectPageBar({ project, pageId, editable, selectedIds, onSelect, onOperation }: {
  project: ProjectDefinition; pageId: string; editable: boolean; selectedIds: string[];
  onSelect: (id: string) => void; onOperation: (operation: ProjectOperation) => void;
}) {
  const page = project.pages.find((page) => page.id === pageId)!;
  const [name, setName] = useState(page.name);
  const [width, setWidth] = useState(String(page.width));
  const [height, setHeight] = useState(String(page.height));
  const [target, setTarget] = useState("");
  useEffect(() => { setName(page.name); setWidth(String(page.width)); setHeight(String(page.height)); setTarget(""); }, [page.id, page.name, page.width, page.height]);
  const rename = () => { if (name !== page.name) onOperation({ type: "page.rename", pageId, name }); };
  const move = (direction: -1 | 1) => {
    const order = project.pages.map((page) => page.id); const index = order.indexOf(pageId);
    if (index + direction < 0 || index + direction >= order.length) return;
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    onOperation({ type: "page.order", pageIds: order });
  };
  return <section className="project-page-bar" aria-label="项目页面">
    <label><span>页面</span><select aria-label="当前页面" value={pageId} onChange={(event) => onSelect(event.target.value)}>{project.pages.map((page) => <option key={page.id} value={page.id}>{page.name}{page.id === project.entryPageId ? " · 入口" : ""}</option>)}</select></label>
    {editable ? <>
      <input aria-label="页面名称" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} onBlur={rename} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      <button type="button" onClick={() => onOperation({ type: "page.add", name: `新页面 ${project.pages.length + 1}` })}>新增页面</button>
      <button type="button" onClick={() => onOperation({ type: "page.duplicate", pageId })}>复制页面</button>
      <button type="button" disabled={project.pages.length === 1} onClick={() => onOperation({ type: "page.delete", pageId })}>删除页面</button>
      <button type="button" disabled={pageId === project.entryPageId} onClick={() => onOperation({ type: "page.entry", pageId })}>设为入口页</button>
      <button type="button" aria-label="页面前移" disabled={project.pages[0].id === pageId} onClick={() => move(-1)}>←</button>
      <button type="button" aria-label="页面后移" disabled={project.pages.at(-1)?.id === pageId} onClick={() => move(1)}>→</button>
      <details className="page-settings"><summary>尺寸与跨页移动</summary><div>
        <label>宽度<input aria-label="页面宽度" type="number" min={320} max={7680} value={width} onChange={(event) => setWidth(event.target.value)} /></label>
        <label>高度<input aria-label="页面高度" type="number" min={240} max={4320} value={height} onChange={(event) => setHeight(event.target.value)} /></label>
        <button type="button" onClick={() => onOperation({ type: "page.configure", pageId, width: Number(width), height: Number(height) })}>应用尺寸</button>
        <label>目标页面<select aria-label="移动到页面" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">选择目标页</option>{project.pages.filter((page) => page.id !== pageId).map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>
        <button type="button" disabled={!target || !selectedIds.length} onClick={() => onOperation({ type: "nodes.move-page", pageId, targetPageId: target, nodeIds: selectedIds })}>移动所选组件</button>
      </div></details>
    </> : null}
  </section>;
}
