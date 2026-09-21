/** Declarative, preview-only interactions. No scripts, HTML or arbitrary requests. */
export type TwinMessageAction = { type: "message"; title: string; text: string };
export type TwinSelectAssetAction = { type: "select-asset"; assetId: string };
export type TwinPanelAction = { type: "panel"; nodeId: string; operation: "show" | "hide" | "toggle" };
export type TwinFocusModelAction = { type: "focus-model"; projectId: string; instanceId: string };
export type TwinSetTextAction = { type: "set-text"; nodeId: string; text: string };
export type TwinAction = TwinMessageAction | TwinSelectAssetAction | TwinPanelAction | TwinFocusModelAction | TwinSetTextAction;
export type CanvasNodeInteraction = { clickActions: TwinAction[]; hiddenInPreview: boolean };

export const TWIN_ACTION_LIMITS = { maximumActions: 8, maximumTitleLength: 80, maximumTextLength: 2000 } as const;
export const TWIN_ACTION_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\\s\\S])";
export const TWIN_ACTION_ASSET_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}(?![\\s\\S])";
export const TWIN_ACTION_TEXT_PATTERN = "^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$";
type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
const identifier = (value: unknown, asset = false) => typeof value === "string" && new RegExp(asset ? TWIN_ACTION_ASSET_ID_PATTERN : TWIN_ACTION_ID_PATTERN).test(value);
const plainText = (value: unknown, minimum: number, maximum: number) => typeof value === "string" && value.length >= minimum && value.length <= maximum && new RegExp(TWIN_ACTION_TEXT_PATTERN).test(value);

/** Structural validation only; persistence and execution must also validate target scope. */
export const parseTwinActions = (value: unknown): ParseResult<TwinAction[]> => {
  if (!Array.isArray(value) || value.length > TWIN_ACTION_LIMITS.maximumActions) return { ok: false, message: `点击动作必须是最多 ${TWIN_ACTION_LIMITS.maximumActions} 项的数组。` };
  for (const [index, action] of value.entries()) {
    const error = (message: string): ParseResult<TwinAction[]> => ({ ok: false, message: `第 ${index + 1} 个点击动作：${message}` });
    if (!record(action)) return error("必须是对象。");
    switch (action.type) {
      case "message":
        if (!exactKeys(action, ["type", "title", "text"]) || !plainText(action.title, 0, TWIN_ACTION_LIMITS.maximumTitleLength) || !plainText(action.text, 1, TWIN_ACTION_LIMITS.maximumTextLength)) return error("文字提示需要有效标题（最多 80 字）和正文（1–2000 字），不能包含控制字符或额外字段。");
        break;
      case "select-asset":
        if (!exactKeys(action, ["type", "assetId"]) || !identifier(action.assetId, true)) return error("设备 ID 无效或存在额外字段。");
        break;
      case "panel":
        if (!exactKeys(action, ["type", "nodeId", "operation"]) || !identifier(action.nodeId) || typeof action.operation !== "string" || !["show", "hide", "toggle"].includes(action.operation)) return error("组件 ID 或显示操作无效，或存在额外字段。");
        break;
      case "focus-model":
        if (!exactKeys(action, ["type", "projectId", "instanceId"]) || !identifier(action.projectId) || !identifier(action.instanceId)) return error("场景 ID 或模型实例 ID 无效，或存在额外字段。");
        break;
      case "set-text":
        if (!exactKeys(action, ["type", "nodeId", "text"]) || !identifier(action.nodeId) || !plainText(action.text, 0, TWIN_ACTION_LIMITS.maximumTextLength)) return error("文本组件 ID 或文字无效（最多 2000 字），或存在额外字段。");
        break;
      default:
        return error("不支持的动作类型。");
    }
  }
  return { ok: true, value: value as TwinAction[] };
};

export const parseCanvasNodeInteraction = (value: unknown): ParseResult<CanvasNodeInteraction> => {
  if (!record(value) || !exactKeys(value, ["clickActions", "hiddenInPreview"]) || typeof value.hiddenInPreview !== "boolean") return { ok: false, message: "组件交互必须包含 clickActions 数组和 hiddenInPreview 布尔值，不能包含额外字段。" };
  const actions = parseTwinActions(value.clickActions);
  return actions.ok ? { ok: true, value: { clickActions: actions.value, hiddenInPreview: value.hiddenInPreview } } : actions;
};
