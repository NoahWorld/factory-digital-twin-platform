import { standaloneScenePath, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { twinDrivePath, type TwinDriveDocument } from "../../../../shared/twin-drive";
import { request, UserFacingError } from "../api";
import { businessApiExampleConfig, businessApiExampleInstances, businessApiExampleSettings } from "./business-api-example";

type SceneResponse = { scene: StandaloneSceneDocument; editable: boolean };
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
};
const sameJson = (first: unknown, second: unknown) => JSON.stringify(canonicalJson(first)) === JSON.stringify(canonicalJson(second));

export async function prepareBusinessApiExample(): Promise<void> {
  const sample = await request<unknown>("/api/v1/test-business/handling-cell/state");
  if (sample === null || typeof sample !== "object" || Array.isArray(sample)) {
    throw new UserFacingError("测试业务接口未返回有效数据，请联系管理员检查后端。");
  }
  const state = sample as Record<string, unknown>;
  if (typeof state.timestamp !== "string" || !Number.isFinite(Date.parse(state.timestamp))) {
    throw new UserFacingError("测试业务接口缺少有效的采样时间，请联系管理员检查后端。");
  }
  for (const point of businessApiExampleConfig().points) {
    let value: unknown = state;
    for (const key of point.sourcePath!.split(".")) {
      value = value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)[key] : undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < point.min || value > point.max
      || (point.valueLabels && !point.valueLabels.some((entry) => entry.value === value))) {
      console.error("[business-api-example] Invalid backend feedback", { path: point.sourcePath, value, minimum: point.min, maximum: point.max });
      throw new UserFacingError(`测试业务接口的「${point.label}」反馈缺失或超出范围，请联系管理员检查后端。`);
    }
  }
}

/** Retry resumes only this newly created project; user edits or other configurations are never replaced. */
export async function populateBusinessApiExample(projectId: string, onProgress: (message: string) => void): Promise<void> {
  onProgress("正在保存示例场景…");
  const current = await request<SceneResponse>(standaloneScenePath(projectId));
  if (!current.editable) throw new UserFacingError("当前账号没有编辑此示例项目的权限。");
  const sceneMatches = sameJson(current.scene.instances, businessApiExampleInstances)
    && sameJson(current.scene.settings, businessApiExampleSettings);
  if (current.scene.revision === 0 && current.scene.instances.length === 0 && current.scene.linked2dProjectId === null) {
    const saved = await request<SceneResponse>(standaloneScenePath(projectId), {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: 0,
        upsertInstances: businessApiExampleInstances,
        deleteInstanceIds: [],
        settings: businessApiExampleSettings,
      }),
    });
    if (!sameJson(saved.scene.instances, businessApiExampleInstances) || !sameJson(saved.scene.settings, businessApiExampleSettings)) {
      throw new UserFacingError("保存后的场景与示例不一致，请打开已创建项目检查。");
    }
  } else if (!sceneMatches || current.scene.linked2dProjectId !== null) {
    throw new UserFacingError("此项目的场景已经修改，不能继续自动创建示例。请打开已创建项目检查。");
  }

  onProgress("正在保存接口与模型绑定…");
  const drive = await request<TwinDriveDocument>(twinDrivePath(projectId));
  if (!drive.editable) throw new UserFacingError("当前账号没有设置此项目数据接口的权限。");
  const config = businessApiExampleConfig();
  if (drive.revision === 0) {
    const saved = await request<TwinDriveDocument>(twinDrivePath(projectId), {
      method: "PUT", body: JSON.stringify({ expectedRevision: 0, config }),
    });
    if (!sameJson(saved.config, config)) throw new UserFacingError("保存后的接口配置与示例不一致，请打开已创建项目检查。");
  } else if (!sameJson(drive.config, config)) {
    throw new UserFacingError("此项目的接口配置已经修改，不能继续自动创建示例。请打开已创建项目检查。");
  }
}
