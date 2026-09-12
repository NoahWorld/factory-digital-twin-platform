import type { InteractionDefinition, InteractionRule, InteractionValue, InteractionCondition } from "./interactions";

/** Only explicit references are remapped; matching text/literals remain untouched. */
export function cloneInteractionScope(config: InteractionDefinition, nodes: ReadonlyMap<string, string>, sourcePage: string, targetPage = sourcePage) {
  const pageCopy = sourcePage !== targetPage;
  const states = pageCopy ? config.states.filter((state) => state.pageId === sourcePage).map((state) => ({ ...state, id: crypto.randomUUID(), pageId: targetPage })) : [];
  const stateMap = new Map(pageCopy ? config.states.filter((state) => state.pageId === sourcePage).map((state, index) => [state.id, states[index].id]) : []);
  const mapPage = (id: string) => id === sourcePage ? targetPage : id;
  const mapValue = (value: InteractionValue): InteractionValue => value.kind === "state" ? { ...value, stateId: stateMap.get(value.stateId) ?? value.stateId } : { ...value };
  const mapCondition = (condition: InteractionCondition | null): InteractionCondition | null => {
    if (!condition) return null;
    if ("conditions" in condition) return { ...condition, conditions: condition.conditions.map((child) => mapCondition(child)!) };
    if ("condition" in condition) return { ...condition, condition: mapCondition(condition.condition)! };
    return "value" in condition ? { ...condition, value: mapValue(condition.value) } : { ...condition, left: mapValue(condition.left), right: mapValue(condition.right) };
  };
  const rules = config.rules.filter((rule) => (pageCopy && rule.pageId === sourcePage)
    || (["node.click", "node.change"].includes(rule.trigger.type) && !!rule.trigger.sourceId && nodes.has(rule.trigger.sourceId))).map((source): InteractionRule => {
      const rule = structuredClone(source);
      rule.id = crypto.randomUUID(); rule.name = `${rule.name.slice(0, 95)} 副本`;
      if (rule.pageId !== null) rule.pageId = mapPage(rule.pageId);
      if (rule.trigger.sourceId) {
        if (rule.trigger.type === "node.click" || rule.trigger.type === "node.change") rule.trigger.sourceId = nodes.get(rule.trigger.sourceId) ?? rule.trigger.sourceId;
        if (rule.trigger.type === "state.change") rule.trigger.sourceId = stateMap.get(rule.trigger.sourceId) ?? rule.trigger.sourceId;
        if (rule.trigger.type === "page.enter") rule.trigger.sourceId = mapPage(rule.trigger.sourceId);
      }
      rule.condition = mapCondition(rule.condition);
      rule.actions = rule.actions.map((action) => {
        if (action.type === "state.set") return { ...action, stateId: stateMap.get(action.stateId) ?? action.stateId, value: mapValue(action.value) };
        if (action.type === "node.visible") return { ...action, nodeId: nodes.get(action.nodeId) ?? action.nodeId };
        if (action.type === "page.navigate") return { ...action, pageId: mapPage(action.pageId) };
        return "value" in action ? { ...action, value: mapValue(action.value) } : action;
      });
      return rule;
    });
  config.states.push(...states); config.rules.push(...rules);
}
