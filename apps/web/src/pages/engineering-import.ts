export type EngineeringFormat = "ifc" | "dxf";
export type EngineeringRole = "floor" | "wall" | "column" | "equipment" | "ignore";
export type EngineeringUnits = "mm" | "cm" | "m" | "in" | "ft";
export type EngineeringLayer = { name: string; entityCount: number; types: string[] };
export type EngineeringInspection = {
  schemaVersion: 1;
  format: EngineeringFormat;
  units: string | null;
  layers: EngineeringLayer[];
  warnings: string[];
  objectCount: number;
};
export type EngineeringJob = {
  id: string;
  projectId: string;
  name: string;
  fileName: string;
  format: EngineeringFormat;
  status: "queued" | "inspecting" | "needs_configuration" | "converting" | "completed" | "failed";
  stage: string;
  message: string;
  progress: number | null;
  createdAt: string;
  updatedAt: string;
  inspection?: EngineeringInspection;
  resourceId?: string;
  result?: { schemaVersion: 1; format: EngineeringFormat; objectCount: number; triangleCount: number; warnings: string[] };
  options?: { schemaVersion: 1; name: string; units?: string; center: boolean; layers: Array<{ name: string; role: EngineeringRole; height: number; base: number }> };
  error?: { code: string; message: string; details?: unknown };
};
export type EngineeringCapabilities = { available: boolean; formats: EngineeringFormat[]; maxSourceBytes: number; maxOutputBytes: number; reason?: string };
export type EngineeringLayerDraft = { name: string; role: EngineeringRole | ""; height: string; base: string };
export const engineeringImportsPath = (projectId: string): string => `/api/v1/projects/${encodeURIComponent(projectId)}/engineering-imports`;
export const engineeringStatusLabels: Record<EngineeringJob["status"], string> = {
  queued: "已排队", inspecting: "正在检查源文件", needs_configuration: "等待确认生成配置",
  converting: "正在生成 GLB", completed: "模型已生成", failed: "任务未完成",
};
export const engineeringStageLabels: Record<string, string> = { uploading: "保存源文件", queued: "等待处理", downloading: "读取已上传的源文件", reading: "读取源文件", validating: "校验单位和图层配置", geometry: "生成构件几何", export: "导出 GLB", complete: "处理完成" };
export const engineeringUnitLabels: Record<EngineeringUnits, string> = { mm: "毫米", cm: "厘米", m: "米", in: "英寸", ft: "英尺" };
export const engineeringWarningLabels: Record<string, string> = {
  ifc_products_without_geometry_excluded: "没有几何表示的 IFC 项目、楼层或其他对象不生成网格。",
  ifc_openings_applied: "IFC 开洞用于扣除宿主构件，不作为独立实体重复生成。",
  cad_paperspace_excluded: "仅转换模型空间；布局空间中的图框、标注等不生成模型。",
  cad_ignored_layers: "明确选择“忽略”的图层不生成模型。",
  cad_units_require_selection: "图纸声明的单位不在当前可选范围内。请确认坐标所用单位，必要时在原软件转换单位后重新导出。",
  cad_simplified_equipment: "设备按轮廓生成简化体，不代表真实设备细节。",
};
export const engineeringErrorLabels: Record<string, string> = {
  engineering_invalid_options: "生成参数不符合要求，请检查单位、图层、高度和基准标高。",
  engineering_invalid_file: "文件无法完整读取，请在原设计软件中检查并重新导出。",
  engineering_unsupported_format: "当前支持 IFC 和 DXF；请将 RVT 导出 IFC，将 DWG 导出 DXF。",
  engineering_unsupported_entity: "建模图层包含尚不支持的图元，请转成支持的闭合轮廓或明确忽略该图层。",
  engineering_invalid_geometry: "图形不满足建模要求，请检查轮廓闭合、自交、方向和几何有效性。",
  engineering_geometry_limit: "模型复杂度或输出大小超出限制，请按楼层或区域拆分文件。",
  engineering_empty_model: "没有可生成的几何，请检查源文件及图层用途。",
  engineering_precision_loss: "源坐标过大或几何过细，无法保留所需精度。请启用坐标居中，必要时拆分或调整模型后重试。",
  engineering_unit_mismatch: "选定单位与图纸声明不一致，请检查图纸单位后重新导出。",
  engineering_conversion_failed: "转换未完成，请保留任务编号并联系管理员查看转换日志。",
  engineering_unavailable: "工程转换服务尚未就绪，请联系管理员检查转换组件。",
  engineering_format_unsupported: "当前支持 IFC 和 DXF；请先导出对应格式。",
  engineering_source_size: "源文件必须非空且不超过 100 MiB，请检查或拆分文件。",
  engineering_queue_full: "转换任务已达并发上限，请等待已有任务完成。",
  engineering_state_conflict: "任务状态已变化，请重新读取后再操作。",
  engineering_import_not_found: "转换任务不存在，请重新读取任务列表。",
  engineering_upload_interrupted: "源文件上传未完成，请确认网络正常后重新导入。",
  engineering_worker_interrupted: "转换进程已中断，请重新生成或联系管理员检查服务重启记录。",
  engineering_result_missing: "转换结果不完整，请保留任务编号并联系管理员。",
  engineering_model_missing: "生成的模型文件缺失，请保留任务编号并联系管理员。",
  engineering_worker_failed: "转换进程未完成，请保留任务编号并联系管理员检查日志。",
  engineering_upload_failed: "源文件保存失败，请重新导入。",
  engineering_timeout: "转换超过运行时限，请拆分文件后重试。",
  engineering_converter_unavailable: "转换服务暂不可用，请联系管理员检查服务。",
  engineering_worker_timeout: "转换超过运行时限，请拆分文件后重试或联系管理员。",
  engineering_output_too_large: "生成的 GLB 超过 25 MiB，请按楼层或区域拆分源文件。",
};

export function engineeringFileError(file: File, maxBytes: number): string | null {
  if (!/\.(ifc|dxf)$/i.test(file.name)) return engineeringErrorLabels.engineering_unsupported_format;
  if (file.size === 0) return "文件为空，请重新选择。";
  if (file.size > maxBytes) return `源文件超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB，请拆分后导入。`;
  return null;
}

export function engineeringConfigurationError(format: EngineeringFormat, units: string, layers: EngineeringLayerDraft[]): string | null {
  if (format === "ifc") return null;
  if (!Object.hasOwn(engineeringUnitLabels, units)) return "请明确选择图纸单位。";
  if (layers.length === 0) return "图纸中没有可配置的图层。";
  for (const layer of layers) {
    if (!["floor", "wall", "column", "equipment", "ignore"].includes(layer.role)) return `请为图层“${layer.name}”选择用途，包括需要忽略的图层。`;
    if (layer.role === "ignore") continue;
    if (layer.height.trim() === "" || !Number.isFinite(Number(layer.height)) || Number(layer.height) <= 0 || Number(layer.height) > 1000) return `请为图层“${layer.name}”填写大于 0、至多 1000 米的高度或厚度。`;
    if (layer.base.trim() === "" || !Number.isFinite(Number(layer.base)) || Math.abs(Number(layer.base)) > 10000) return `图层“${layer.name}”的基准标高必须在 −10000 至 10000 米内。`;
  }
  if (layers.every((layer) => layer.role === "ignore")) return "至少保留一个用于生成模型的图层。";
  return null;
}

/** Only reviewed codes and bounded source identifiers reach the UI, never raw converter messages. */
export function engineeringIssues(details: unknown): Array<{ code: string; layer?: string; handle?: string; entityType?: string }> {
  if (!details || typeof details !== "object" || !("issues" in details) || !Array.isArray(details.issues)) return [];
  return details.issues.slice(0, 100).flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object" || !("code" in issue) || typeof issue.code !== "string") return [];
    const record = issue as Record<string, unknown>;
    const identifier = (key: string): string | undefined => typeof record[key] === "string" ? record[key].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) : undefined;
    return [{ code: issue.code, layer: identifier("layer"), handle: identifier("handle"), entityType: identifier("entityType") }];
  });
}
