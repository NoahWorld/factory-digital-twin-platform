import { useMemo, useState } from "react";
import { STANDALONE_3D_LIMITS, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { parseRoomAlarms } from "../../../../shared/room-alarms";
import { Model3DNode, type Model3DNodeProps } from "../canvas/Model3DNode";
import { useIotFluids } from "../canvas/useIotEmbed";
import { useRoomAlarmData } from "../twin/useRoomAlarmData";
import { RoomAlarmStatusPanel } from "./RoomAlarmStatusPanel";
import type { RoomAlarmStatus } from "./room-alarm-runtime";
import type { PlaybackState, SceneFluidBinding } from "../../../../shared/scene-playback";
import { projectRuntimePlayback } from "../twin/preview-playback";

/** Same read-only visuals in embedded scenes and fixed publications. */
export function RoomAlarmSceneNode({ scene, rendererProps, playback, playbackBindings }: {
  scene: StandaloneSceneDocument;
  rendererProps: Model3DNodeProps;
  playback?: PlaybackState;
  playbackBindings?: SceneFluidBinding[];
}) {
  const fluidRuntime = useIotFluids(scene, true);
  const fluids = useMemo(() => playback ? projectRuntimePlayback(scene, fluidRuntime.fluids, playback, playbackBindings).fluids : fluidRuntime.fluids,
    [scene, fluidRuntime.fluids, playback, playbackBindings]);
  const parsed = useMemo(() => parseRoomAlarms(scene.roomAlarms === undefined ? [] : scene.roomAlarms), [scene.roomAlarms]);
  const rules = useMemo(() => parsed.ok ? parsed.value : [], [parsed]);
  const [statuses, setStatuses] = useState<RoomAlarmStatus[]>([]);
  const data = useRoomAlarmData({ projectId: scene.projectId, linkedProjectId: scene.linked2dProjectId, rules, enabled: true });
  return <>
    <Model3DNode {...rendererProps} maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances} fluids={fluids} decorations={scene.decorations} staticMap={scene.staticMap} roomAlarms={rules}
      roomAlarmObservations={data.observations} onRoomAlarmStatuses={setStatuses} />
    {fluidRuntime.errors.length ? <div className="process-runtime-error" role="status">{fluidRuntime.errors.join("；")}</div> : null}
    {parsed.ok ? <RoomAlarmStatusPanel rules={rules} statuses={statuses} /> : <div role="alert" className="scene-room-status is-unknown">房间报警配置无效：{parsed.message}</div>}
  </>;
}
