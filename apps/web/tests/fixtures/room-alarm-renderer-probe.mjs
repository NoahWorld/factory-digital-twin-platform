export const renderedModels = [];
export const fluidHookCalls = [];
let fluidRuntime = { fluids: [], errors: [] };

export function setFluidRuntime(runtime) {
  fluidRuntime = runtime;
  fluidHookCalls.length = 0;
}

export function useIotFluids(scene, enabled) {
  fluidHookCalls.push({ scene, enabled });
  return fluidRuntime;
}

export function Model3DNode(props) {
  renderedModels.push(props);
  return null;
}

export function useRoomAlarmData() {
  return { observations: {} };
}
