import { useCallback, useEffect, useRef, useState } from "react";
import { parseTwinActions, type TwinAction } from "../../../../shared/twin-actions";
import type { ProjectAsset } from "../canvas/assets";
import type { CanvasDocument } from "../canvas/types";
import type { TwinActionScene } from "./TwinActionEditor";

export type TwinActionMessage = { title: string; text: string };
export type TwinActionState = {
  nodeVisibility: Record<string, boolean>;
  textOverrides: Record<string, string>;
  messages: TwinActionMessage[];
};
export type TwinActionContext = {
  canvasDocument: CanvasDocument | null;
  assets: readonly ProjectAsset[];
  scenes: readonly TwinActionScene[];
};
export type TwinActionRuntimeOptions = TwinActionContext & {
  contextKey: string;
  onSelectAsset?: (assetId: string) => void;
  onFocusModel?: (projectId: string, instanceId: string) => void;
};

export const emptyTwinActionState = (): TwinActionState => ({ nodeVisibility: {}, textOverrides: {}, messages: [] });

/** Resolve every reference before dispatching any effects; a bad final action cannot partly run a group. */
export function validateTwinActionTargets(actions: readonly TwinAction[], context: TwinActionContext): TwinAction[] {
  const parsed = parseTwinActions(actions);
  if (!parsed.ok) throw new Error(parsed.message);
  for (const [index, action] of parsed.value.entries()) {
    const prefix = `动作 ${index + 1}（${action.type}）`;
    if (action.type === "panel" || action.type === "set-text") {
      const node = context.canvasDocument?.nodes.find((candidate) => candidate.id === action.nodeId);
      if (!node) throw new Error(`${prefix}：2D 项目 ${context.canvasDocument?.projectId ?? "未关联"} 中找不到组件 ${action.nodeId}。`);
      if (action.type === "panel" && (node.type === "model-3d" || node.type === "scene-3d")) throw new Error(`${prefix}：组件 ${action.nodeId} 是 3D 内容，显示交互仅支持纯 2D 组件。`);
      if (action.type === "set-text" && node.type !== "plain-text") throw new Error(`${prefix}：组件 ${action.nodeId} 不是纯文本，不能更新内容。`);
    } else if (action.type === "select-asset") {
      if (!context.assets.some((asset) => asset.assetId === action.assetId)) throw new Error(`${prefix}：业务设备 ${action.assetId} 不存在或当前账号无权访问。`);
    } else if (action.type === "focus-model") {
      const scene = context.scenes.find((candidate) => candidate.projectId === action.projectId);
      if (!scene) throw new Error(`${prefix}：3D 场景 ${action.projectId} 尚未加载或当前账号无权访问。`);
      const instance = scene.instances.find((candidate) => candidate.id === action.instanceId);
      if (!instance) throw new Error(`${prefix}：场景 ${action.projectId} 中找不到模型 ${action.instanceId}。`);
      if (!instance.visible) throw new Error(`${prefix}：模型 ${instance.label}（${instance.id}）已隐藏，无法聚焦。`);
    }
  }
  return parsed.value;
}

/** Pure state transition: never modifies the saved canvas or scene. */
export function planTwinActions(actions: readonly TwinAction[], context: TwinActionContext, state: TwinActionState): { state: TwinActionState; effects: TwinAction[] } {
  const parsed = validateTwinActionTargets(actions, context);
  if (state.messages.length + parsed.filter((action) => action.type === "message").length > 32) throw new Error("待查看的交互消息超过 32 条，请先关闭已有消息。");
  const next: TwinActionState = {
    nodeVisibility: { ...state.nodeVisibility },
    textOverrides: { ...state.textOverrides },
    messages: [...state.messages],
  };
  const effects: TwinAction[] = [];
  for (const action of parsed) {
    switch (action.type) {
      case "message": next.messages.push({ title: action.title, text: action.text }); break;
      case "panel": {
        const node = context.canvasDocument!.nodes.find((candidate) => candidate.id === action.nodeId)!;
        const visible = Object.hasOwn(next.nodeVisibility, action.nodeId) ? next.nodeVisibility[action.nodeId] : !node.interaction?.hiddenInPreview;
        next.nodeVisibility[action.nodeId] = action.operation === "toggle" ? !visible : action.operation === "show";
        break;
      }
      case "set-text": next.textOverrides[action.nodeId] = action.text; break;
      case "focus-model": case "select-asset": effects.push(action); break;
    }
  }
  return { state: next, effects };
}

export function useTwinActions({ canvasDocument, assets, scenes, contextKey, onSelectAsset, onFocusModel }: TwinActionRuntimeOptions) {
  const [state, setState] = useState<TwinActionState>(emptyTwinActionState);
  const stateRef = useRef(state);
  const [error, setError] = useState<string | null>(null);
  const reset = useCallback(() => {
    const next = emptyTwinActionState();
    stateRef.current = next;
    setState(next);
    setError(null);
  }, []);
  useEffect(() => { reset(); }, [contextKey, reset]);

  const execute = useCallback((actions: readonly TwinAction[], source: string): boolean => {
    try {
      const plan = planTwinActions(actions, { canvasDocument, assets, scenes }, stateRef.current);
      for (const action of plan.effects) {
        if (action.type === "select-asset" && !onSelectAsset) throw new Error(`当前页面未提供业务设备详情处理器（${action.assetId}）。`);
        if (action.type === "focus-model" && !onFocusModel) throw new Error(`当前页面未提供模型聚焦处理器（${action.projectId}/${action.instanceId}）。`);
      }
      for (const action of plan.effects) {
        if (action.type === "select-asset") onSelectAsset!(action.assetId);
        if (action.type === "focus-model") onFocusModel!(action.projectId, action.instanceId);
      }
      stateRef.current = plan.state;
      setState(plan.state);
      setError(null);
      return true;
    } catch (reason) {
      const message = `${source}：${reason instanceof Error ? reason.message : String(reason)}`;
      console.error("Twin action execution failed", { contextKey, source, actions, reason });
      setError(message);
      return false;
    }
  }, [assets, canvasDocument, contextKey, onFocusModel, onSelectAsset, scenes]);

  const dismissMessage = useCallback(() => {
    const next = { ...stateRef.current, messages: stateRef.current.messages.slice(1) };
    stateRef.current = next;
    setState(next);
  }, []);
  const dismissError = useCallback(() => setError(null), []);
  return { ...state, error, execute, dismissMessage, dismissError, reset };
}
