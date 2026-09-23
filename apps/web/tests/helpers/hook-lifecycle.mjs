// Minimal synchronous hook lifecycle for isolated wiring tests; not a DOM or React replacement.
let active;
const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const slot = () => {
  if (!active) throw new Error('Hook used outside test harness');
  return [active, active.cursor++];
};
export function useState(initial) {
  const [h, index] = slot();
  if (!(index in h.slots)) h.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
  return [h.slots[index].value, (update) => {
    const previous = h.slots[index].value;
    const next = typeof update === 'function' ? update(previous) : update;
    if (!Object.is(previous, next)) { h.slots[index].value = next; h.dirty = true; }
  }];
}
export function useMemo(factory, deps) {
  const [h, index] = slot();
  if (!same(h.slots[index]?.deps, deps)) h.slots[index] = { value: factory(), deps };
  return h.slots[index].value;
}
export const useCallback = (callback, deps) => useMemo(() => callback, deps);
export function useRef(value) { return useMemo(() => ({ current: value }), []); }
export function useEffect(effect, deps) {
  const [h, index] = slot();
  if (!same(h.slots[index]?.deps, deps)) {
    h.pending.push({ index, effect });
    h.slots[index] = { ...h.slots[index], deps };
  }
}
export function hookLifecycle(hook) {
  const h = { slots: [], cursor: 0, pending: [], dirty: true, value: null };
  return {
    flush() {
      for (let count = 0; h.dirty; count++) {
        if (count > 20) throw new Error('Hook did not stabilize');
        h.dirty = false; h.cursor = 0; active = h;
        try { h.value = hook(); } finally { active = null; }
        const pending = h.pending.splice(0);
        pending.forEach(({ index }) => h.slots[index].cleanup?.());
        pending.forEach(({ index, effect }) => { h.slots[index].cleanup = effect(); });
      }
      return h.value;
    },
    unmount() { h.slots.forEach((entry) => entry?.cleanup?.()); },
  };
}
