import type { RoomAlarmRule } from "../../../../shared/room-alarms";
import type { RoomAlarmStatus } from "./room-alarm-runtime";
import "./room-alarm-status.css";

const labels = { normal: "正常", alarm: "报警", waiting: "等待数据", stale: "数据陈旧", offline: "失联", error: "配置或数据错误" };
export function RoomAlarmStatusPanel({ rules, statuses }: { rules: RoomAlarmRule[]; statuses: RoomAlarmStatus[] }) {
  const activeRules = rules.filter(rule => rule.enabled);
  if (!activeRules.length) return null;
  const alarming = statuses.filter(status => status.active).length;
  const uncertain = activeRules.filter(rule => {
    const status = statuses.find(item => item.id === rule.id);
    return !status || (status.state !== "normal" && status.state !== "alarm");
  }).length;
  return <details className={`scene-room-status${alarming ? " is-alarm" : uncertain ? " is-unknown" : ""}`}>
    <summary aria-live="polite">房间报警 · {alarming ? `${alarming} 处报警` : uncertain ? `${uncertain} 处状态待确认` : "状态正常"}</summary>
    <ul>{activeRules.map(rule => {
      const status = statuses.find(item => item.id === rule.id);
      return <li key={rule.id} data-room-rule={rule.id} data-room-state={status?.state ?? "waiting"}>
        <strong>{rule.label} · {labels[status?.state ?? "waiting"]}</strong>
        <span>{status?.message ?? "等待有效数据"}</span>
      </li>;
    })}</ul>
  </details>;
}
