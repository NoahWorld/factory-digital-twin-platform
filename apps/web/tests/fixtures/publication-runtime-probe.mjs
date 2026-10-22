import { useState as reactUseState } from 'react';
export { useEffect, useMemo } from 'react';

export const canvasHookCalls = [];
let loadedResponse;
let projectedRuntime;
let stateIndex = 0;

// Seed only the publication page's response state; descendants use real React.
export function setPublicationRuntime(response, runtime) {
  loadedResponse = response;
  projectedRuntime = runtime;
  stateIndex = 0;
  canvasHookCalls.length = 0;
}

export function useState(initial) {
  return reactUseState(stateIndex++ === 0 ? loadedResponse : initial);
}

export function useIotEmbed(document, enabled) {
  canvasHookCalls.push({ document, enabled });
  return projectedRuntime;
}
