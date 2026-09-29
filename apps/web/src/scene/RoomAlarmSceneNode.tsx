import { useMemo, useState } from "react";
import { STANDALONE_3D_LIMITS, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { parseRoomAlarms } from "../../../../shared/room-alarms";
import { Model3DNode, type Model3DNodeProps } from "../canvas/Model3DNode";
import { useRoomAlarmData } from "../twin/useRoomAlarmData";
import { RoomAlarmStatusPanel } from "./RoomAlarmStatusPanel";
import type { RoomAlarmStatus } from "./room-alarm-runtime";

/** Same read-only visuals in embedded scenes and fixed publications. */
export function RoomAlarmSceneNode({ scene, rendererProps }: { scene: StandaloneSceneDocument; rendererProps: Model3DNodeProps }) {
  const parsed = useMemo(() => parseRoomAlarms(scene.roomAlarms === undefined ? [] : scene.roomAlarms), [scene.roomAlarms]);
  const rules = useMemo(() => parsed.ok ? parsed.value : [], [parsed]);
  const [statuses, setStatuses] = useState<RoomAlarmStatus[]>([]);
  const data = useRoomAlarmData({ projectId: scene.projectId, linkedProjectId: scene.linked2dProjectId, rules, enabled: true });
  return <>
    <Model3DNode {...rendererProps} maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances} fluids={scene.fluids} decorations={scene.decorations} staticMap={scene.staticMap} roomAlarms={rules}
      roomAlarmObservations={data.observations} onRoomAlarmStatuses={setStatuses} />
    {parsed.ok ? <RoomAlarmStatusPanel rules={rules} statuses={statuses} /> : <div role="alert" className="scene-room-status is-unknown">房间报警配置无效：{parsed.message}</div>}
  </>;
}
