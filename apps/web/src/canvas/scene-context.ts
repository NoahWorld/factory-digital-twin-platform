import { createContext, useContext } from "react";
import type { SceneDefinition } from "../../../../shared/scene-definition";
export const SceneCatalogContext = createContext<SceneDefinition[]>([]);
export const useSceneCatalog = () => useContext(SceneCatalogContext);
