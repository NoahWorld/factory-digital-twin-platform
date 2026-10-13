import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";

/** Display metadata never changes the stable nodeName saved in a binding. */
export function twinTargetLabel(node: Pick<TwinNodeCatalogEntry, "nodeName" | "label">, nodes: readonly Pick<TwinNodeCatalogEntry, "nodeName">[]): string {
  if (node.label?.trim()) return node.label.trim();
  if (/\p{Script=Han}/u.test(node.nodeName)) return node.nodeName;
  const index = nodes.findIndex((entry) => entry.nodeName === node.nodeName);
  return index >= 0 ? `部件 ${index + 1}` : "原部件已不可用";
}

export function twinTargetSearch(node: Pick<TwinNodeCatalogEntry, "nodeName" | "label">, search: string, nodes: readonly Pick<TwinNodeCatalogEntry, "nodeName">[]): boolean {
  return `${twinTargetLabel(node, nodes)} ${node.nodeName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}
