import { useState } from "react";
import { TWIN_DRIVE_LIMITS, type TwinPoseKey, type TwinVector } from "../../../../shared/twin-drive";
import { Select } from "../components/Select";

const numeric = (value: string) => value.trim() === "" ? NaN : Number(value);

function PoseVector({ label, value, onChange, min = -1e6 }: {
  label: string; value: TwinVector; onChange: (value: TwinVector) => void; min?: number;
}) {
  return <fieldset className="twin-vector"><legend>{label}</legend>
    {value.map((coordinate, axis) => <label key={axis}><span>{["X", "Y", "Z"][axis]}</span>
      <input type="number" step="any" min={min} max={1e6} aria-label={`${label} ${["X", "Y", "Z"][axis]}`}
        value={Number.isFinite(coordinate) ? coordinate : ""} onChange={(event) => {
          const next: TwinVector = [...value]; next[axis] = numeric(event.target.value); onChange(next);
        }} />
    </label>)}
  </fieldset>;
}

export function TwinPoseFields({ poses, onChange }: { poses: TwinPoseKey[]; onChange: (poses: TwinPoseKey[]) => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const index = Math.min(selectedIndex, Math.max(0, poses.length - 1));
  const pose = poses[index];
  const last = poses.at(-1);
  const nextValue = last ? last.value + 1 : 0;
  const canAdd = poses.length < TWIN_DRIVE_LIMITS.poses && Number.isFinite(nextValue) && (!last || nextValue > last.value);
  const patch = (change: Partial<TwinPoseKey>) => onChange(poses.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));

  return <section className="twin-card">
    <h3>关键姿态</h3>
    <p className="twin-help">为几个代表性点位值设置部件姿态，中间数值会平滑过渡。按点位值从小到大排列，至少保留 2 个姿态。</p>
    <div className="twin-row">
      <label><span>正在编辑的姿态</span><Select value={pose ? String(index) : ""} disabled={!poses.length} onValueChange={(value) => setSelectedIndex(Number(value))}>
        {!poses.length && <option value="">尚未添加姿态</option>}
        {poses.map((item, itemIndex) => <option key={itemIndex} value={String(itemIndex)}>姿态 {itemIndex + 1} · 点位值 {Number.isFinite(item.value) ? item.value : "待填写"}</option>)}
      </Select></label>
      <button type="button" className="secondary-button compact-button" disabled={!canAdd} onClick={() => {
        onChange([...poses, { value: nextValue, position: last ? [...last.position] : [0, 0, 0], rotation: last ? [...last.rotation] : [0, 0, 0], scale: last ? [...last.scale] : [1, 1, 1] }]);
        setSelectedIndex(poses.length);
      }}>＋ 添加姿态</button>
    </div>
    {poses.length >= TWIN_DRIVE_LIMITS.poses && <p className="twin-help">最多可设置 {TWIN_DRIVE_LIMITS.poses} 个关键姿态。</p>}
    {!Number.isFinite(nextValue) || (last && nextValue <= last.value) ? <p className="twin-error">请先修正最后一个姿态的点位值，再添加姿态。</p> : null}
    {pose && <>
      <label><span>点位达到这个值时</span><input type="number" step="any" value={Number.isFinite(pose.value) ? pose.value : ""} onChange={(event) => patch({ value: numeric(event.target.value) })} /></label>
      <PoseVector label="位置（米）" value={pose.position} onChange={(position) => patch({ position })} />
      <PoseVector label="旋转角度（度）" value={pose.rotation} onChange={(rotation) => patch({ rotation })} />
      <PoseVector label="尺寸比例（1 为原始尺寸）" value={pose.scale} min={0} onChange={(scale) => patch({ scale })} />
      <div className="twin-row"><span className="twin-help">{index + 1} / {poses.length} 个姿态</span>
        <button type="button" className="secondary-button compact-button twin-danger" disabled={poses.length <= 2}
          title={poses.length <= 2 ? "姿态映射至少需要 2 个关键姿态" : undefined} onClick={() => {
            onChange(poses.filter((_, itemIndex) => itemIndex !== index)); setSelectedIndex(Math.max(0, index - 1));
          }}>删除这个姿态</button>
      </div>
    </>}
  </section>;
}
