export type GroupableProject = {
  id: string;
  name: string;
  projectType: "2d" | "3d";
  relatedProjectIds: string[];
  has3dContent: boolean;
};

export function groupProjects<T extends GroupableProject>(projects: T[]) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const incoming = new Map(projects.map((project) => [project.id, new Set<string>()]));
  const combined: T[] = [];
  const scenes: T[] = [];
  const boards: T[] = [];
  for (const project of projects) {
    if (typeof project.has3dContent !== "boolean" || !Array.isArray(project.relatedProjectIds) || project.relatedProjectIds.some((id) => typeof id !== "string" || !id)) {
      throw new Error("项目分类信息不完整，请检查后端版本并重新加载项目列表。");
    }
    for (const id of project.relatedProjectIds) {
      if (byId.has(id)) incoming.get(id)!.add(project.id);
    }
    if (project.projectType === "3d") scenes.push(project);
    else if (project.has3dContent) combined.push(project);
    else boards.push(project);
  }
  return { combined, scenes, boards, incoming, byId };
}
