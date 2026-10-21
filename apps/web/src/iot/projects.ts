import { ApiRequestError, request } from "../api";

/** Read every page so counts, resource selectors and linked scenes share one project list. */
export async function loadIotProjects<T extends { id: string }>(signal?: AbortSignal): Promise<{ projects: T[] }> {
  const projects: T[] = [];
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const result = await request<{ projects: T[]; nextOffset: number | null }>(
      `/api/v1/projects?limit=1000&offset=${offset}`, { signal });
    if (!Array.isArray(result.projects) || result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)) {
      throw new ApiRequestError("invalid_response", undefined, "Invalid IoT project pagination.");
    }
    for (const project of result.projects) {
      if (!project || typeof project.id !== "string" || ids.has(project.id)) {
        throw new ApiRequestError("invalid_response", undefined, "Project list changed during pagination; reload it.");
      }
      ids.add(project.id);
      projects.push(project);
    }
    if (result.nextOffset === null) return { projects };
    offset = result.nextOffset;
  }
}
