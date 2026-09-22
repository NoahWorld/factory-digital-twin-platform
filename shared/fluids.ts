/** Persisted procedural fluid visuals. Coordinates are in scene-local, Y-up units. */
export type FluidKind = "gas" | "liquid" | "molten";
export type FluidPoint = [number, number, number];
export type FluidDefinition = {
  id: string;
  label: string;
  kind: FluidKind;
  color: string;
  mode: "stream" | "diffuse";
  points: FluidPoint[];
  radius: number;
  speed: number;
  spread: number;
  opacity: number;
  direction: "forward" | "reverse";
  visible: boolean;
  playing: boolean;
};

export const FLUID_LIMITS = {
  maximumFluids: 32,
  minimumPoints: 2,
  maximumPoints: 64,
  maximumCoordinate: 10_000,
  minimumRadius: 0.01,
  maximumRadius: 20,
  minimumSpeed: 0.01,
  maximumSpeed: 30,
  minimumSpread: 0,
  maximumSpread: 10,
  minimumOpacity: 0.05,
  maximumOpacity: 1,
  maximumLabelLength: 80,
} as const;
export const FLUID_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\\s\\S])";
export const FLUID_COLOR_PATTERN = "^#[0-9a-fA-F]{6}(?![\\s\\S])";
export const FLUID_LABEL_PATTERN = "^[^\\u0000-\\u001f\\u007f]*[^\\s\\u0000-\\u001f\\u007f][^\\u0000-\\u001f\\u007f]*(?![\\s\\S])";
const fields = new Set(["id", "label", "kind", "color", "mode", "points", "radius", "speed", "spread", "opacity", "direction", "visible", "playing"]);
const finiteWithin = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

/** New editor draft: the user must draw at least two points before saving. */
export const createFluidDefinition = (id: string, kind: FluidKind = "liquid"): FluidDefinition => ({
  id, kind, label: kind === "gas" ? "气体" : kind === "molten" ? "熔融体" : "液体",
  color: kind === "gas" ? "#cbd5e1" : kind === "molten" ? "#ff6b20" : "#38bdf8",
  mode: kind === "gas" ? "diffuse" : "stream", points: [], radius: 0.25, speed: 1,
  spread: 1, opacity: kind === "gas" ? 0.45 : 0.8,
  direction: "forward", visible: true, playing: true,
});

export const parseFluids = (input: unknown): { ok: true; value: FluidDefinition[] } | { ok: false; message: string } => {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (!Array.isArray(input) || input.length > FLUID_LIMITS.maximumFluids) return fail(`fluids must be an array of at most ${FLUID_LIMITS.maximumFluids} entries.`);
  const ids = new Set<string>();
  const fluids: FluidDefinition[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const raw: unknown = input[index];
    const context = `fluids[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(`${context} must be an object.`);
    const value = raw as Record<string, unknown>;
    const unknown = Object.keys(value).find((key) => !fields.has(key));
    if (unknown) return fail(`${context}.${unknown} is not supported.`);
    const missing = [...fields].find((key) => !Object.hasOwn(value, key));
    if (missing) return fail(`${context}.${missing} is required.`);
    if (typeof value.id !== "string" || !new RegExp(FLUID_ID_PATTERN).test(value.id)) return fail(`${context}.id must be a stable identifier.`);
    if (ids.has(value.id)) return fail(`${context}.id duplicates ${value.id}.`);
    ids.add(value.id);
    if (typeof value.label !== "string" || value.label.length > FLUID_LIMITS.maximumLabelLength || !new RegExp(FLUID_LABEL_PATTERN).test(value.label)) return fail(`${context}.label must contain 1 to ${FLUID_LIMITS.maximumLabelLength} printable characters.`);
    if (value.kind !== "gas" && value.kind !== "liquid" && value.kind !== "molten") return fail(`${context}.kind must be gas, liquid or molten.`);
    if (typeof value.color !== "string" || !new RegExp(FLUID_COLOR_PATTERN).test(value.color)) return fail(`${context}.color must be a six-digit hexadecimal color.`);
    if (value.mode !== "stream" && value.mode !== "diffuse") return fail(`${context}.mode must be stream or diffuse.`);
    if (value.direction !== "forward" && value.direction !== "reverse") return fail(`${context}.direction must be forward or reverse.`);
    if (typeof value.visible !== "boolean" || typeof value.playing !== "boolean") return fail(`${context}.visible and playing must be booleans.`);
    for (const [key, minimum, maximum] of [
      ["radius", FLUID_LIMITS.minimumRadius, FLUID_LIMITS.maximumRadius],
      ["speed", FLUID_LIMITS.minimumSpeed, FLUID_LIMITS.maximumSpeed],
      ["spread", FLUID_LIMITS.minimumSpread, FLUID_LIMITS.maximumSpread],
      ["opacity", FLUID_LIMITS.minimumOpacity, FLUID_LIMITS.maximumOpacity],
    ] as const) if (!finiteWithin(value[key], minimum, maximum)) return fail(`${context}.${key} must be a finite number between ${minimum} and ${maximum}.`);
    if (!Array.isArray(value.points) || value.points.length < FLUID_LIMITS.minimumPoints || value.points.length > FLUID_LIMITS.maximumPoints) return fail(`${context}.points must contain ${FLUID_LIMITS.minimumPoints} to ${FLUID_LIMITS.maximumPoints} points.`);
    const points: FluidPoint[] = [];
    for (let pointIndex = 0; pointIndex < value.points.length; pointIndex += 1) {
      const point: unknown = value.points[pointIndex];
      if (!Array.isArray(point) || point.length !== 3 || !point.every((coordinate) => finiteWithin(coordinate, -FLUID_LIMITS.maximumCoordinate, FLUID_LIMITS.maximumCoordinate))) return fail(`${context}.points[${pointIndex}] must contain three finite coordinates within ±${FLUID_LIMITS.maximumCoordinate}.`);
      if (pointIndex > 0 && points[pointIndex - 1].every((coordinate, axis) => coordinate === point[axis])) return fail(`${context}.points[${pointIndex}] must differ from the previous point.`);
      points.push([point[0], point[1], point[2]]);
    }
    fluids.push({ ...value, points } as FluidDefinition);
  }
  return { ok: true, value: fluids };
};
