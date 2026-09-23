import { useState } from "react";
import type { TwinDriveConfig } from "../../../../shared/twin-drive";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";
import { Select } from "../components/Select";
import { prepareTwinBindingRemap, suggestTwinRemapNodes, twinRemapRows, twinRemapSources, twinRemapTargetNodes, type TwinRemapNodes } from "./twin-binding-remap";

export function TwinBindingRemap({ config, scene, catalog, onChange }: {
  config: TwinDriveConfig; scene: StandaloneSceneDocument; catalog: TwinNodeCatalogEntry[];
  onChange: (config: TwinDriveConfig) => void;
}) {
  const [sourceKey, setSourceKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [nodeNames, setNodeNames] = useState<TwinRemapNodes>({});
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const sources = twinRemapSources(config, scene);
  const source = sources.find((item) => item.key === sourceKey);
  const rows = twinRemapRows(config, sourceKey);
  const nodes = twinRemapTargetNodes(scene, catalog, targetId);
  const matchingNodes = nodes.filter((node) => node.nodeName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const visibleNodes = matchingNodes.slice(0, 200);
  const result = prepareTwinBindingRemap(config, scene, catalog, sourceKey, targetId, nodeNames);
  return <section className="twin-card twin-remap">
    <div className="twin-remap-heading"><h3>更换模型，保留配置</h3><p className="twin-help">为已有动作选择新模型中的对应部件，保留数据、动作参数、碰撞规则和工序。</p></div>
    {!sources.length ? <p className="twin-help">建立部件绑定后，可在这里将整组配置用于另一个模型。</p> : <>
      <div className="twin-fields">
        <label><span>原模型</span><Select value={sourceKey} onValueChange={(value) => { setSourceKey(value); setTargetId(""); setNodeNames({}); setSearch(""); setNotice(null); }}>
          <option value="">选择要保留配置的模型</option>
          {sources.map((item) => <option key={item.key} value={item.key}>{item.label} · {item.bindingCount} 个动作 / {item.colliderCount} 个碰撞部件</option>)}
        </Select></label>
        <label><span>新模型</span><Select value={targetId} disabled={!source} onValueChange={(value) => {
          setTargetId(value); setNodeNames(suggestTwinRemapNodes(rows, scene, catalog, value)); setSearch(""); setNotice(null);
        }}><option value="">选择场景中的模型</option>{scene.instances.map((item) => <option key={item.id} value={item.id} disabled={item.id === source?.instanceId && item.modelAssetId === source.modelAssetId}>{item.label}</option>)}</Select></label>
      </div>
      {source?.unavailable ? <p className="twin-help">原模型已移除或更换，原有配置仍完整保留。请逐项确认新部件。</p> : null}
      {targetId && rows.length ? <>
        <div className="twin-row twin-remap-toolbar"><label><span>查找新模型的部件</span><input placeholder="输入部件名称" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button type="button" className="secondary-button compact-button" onClick={() => {
            const suggestions = suggestTwinRemapNodes(rows, scene, catalog, targetId);
            setNodeNames((current) => Object.fromEntries(rows.map((row) => [row.key, current[row.key] || suggestions[row.key]])));
          }}>补齐同名部件</button>
        </div>
        <p className="twin-help">预填仅匹配名称唯一的同名部件，请逐项确认后应用。{matchingNodes.length > 200 ? `找到 ${matchingNodes.length} 个部件，显示前 200 个，请继续筛选。` : `新模型有 ${nodes.length} 个可检查的部件。`}</p>
        {!nodes.length ? <p className="twin-error" role="alert">新模型的部件尚未加载或不可用，暂时无法应用。请先确认该模型已在场景中加载。</p> : null}
        <div className="twin-remap-list">{rows.map((row) => {
          const selected = nodeNames[row.key] ?? "";
          const selectedNode = nodes.find((node) => node.nodeName === selected);
          const unavailable = (node: typeof nodes[number]) => !node.unique || (row.kind === "binding" && !node.drivable);
          const nodeLabel = (node: typeof nodes[number]) => `${node.nodeName}${!node.unique ? "（重名，不可绑定）" : row.kind === "binding" && !node.drivable ? "（模型根节点，不可用于动作）" : ""}`;
          return <div key={row.key} className="twin-remap-row">
            <div className="twin-remap-origin"><strong>{row.label}</strong><span>{row.kind === "binding" ? "动作" : "碰撞部件"} · {row.target.nodeName || "尚未选择部件"}</span></div>
            <label><span>对应的新部件</span><Select aria-label={`${row.label}对应的新部件`} value={selected} onValueChange={(value) => setNodeNames({ ...nodeNames, [row.key]: value })}>
              <option value="">请选择对应部件</option>
              {selected && !visibleNodes.some((node) => node.nodeName === selected) ? <option value={selected} disabled={!selectedNode || unavailable(selectedNode)}>{selectedNode ? nodeLabel(selectedNode) : `${selected}（已不可用）`}</option> : null}
              {visibleNodes.map((node) => <option key={node.nodeName} value={node.nodeName} disabled={unavailable(node)}>{nodeLabel(node)}</option>)}
            </Select></label>
          </div>;
        })}</div>
        {result.errors.length ? <details className="twin-validation twin-remap-errors"><summary>{result.errors.length} 项需要确认，暂时不能应用</summary><ul>{result.errors.map((message) => <li key={message}>{message}</li>)}</ul></details> : null}
        <div className="twin-row twin-remap-footer"><span>{result.mappedCount} / {result.totalCount} 项已选择。应用后仍需保存配置。</span><button type="button" className="secondary-button" disabled={!result.config} onClick={() => {
          if (!result.config) return;
          onChange(result.config); setNotice(`已将 ${result.totalCount} 项绑定应用到草稿，请检查动作范围并保存配置。`);
          setSourceKey(""); setTargetId(""); setNodeNames({}); setSearch("");
        }}>应用到草稿</button></div>
      </> : null}
    </>}
    {notice ? <p className="twin-success" role="status">{notice}</p> : null}
  </section>;
}
