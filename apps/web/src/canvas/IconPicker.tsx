import { useState } from "react";
import { iconCatalog, type IconId } from "../../../../shared/icon-catalog";
import { LocalIcon } from "./LocalIcon";

const categories = ["全部", ...new Set(iconCatalog.map((icon) => icon.category))];
export function IconPicker({ value, onChange, disabled, allowNone = false }: {
  value: string; onChange: (id: IconId | "none") => void; disabled: boolean; allowNone?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const visible = iconCatalog.filter((icon) => (category === "全部" || icon.category === category) && `${icon.label} ${icon.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="icon-picker">
    <div className="icon-picker-search">
      <input type="search" aria-label="搜索图标" placeholder="搜索图标，如设备、告警" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="图标分类" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    {allowNone ? <button type="button" className="icon-picker-none" disabled={disabled} aria-pressed={value === "none"} onClick={() => onChange("none")}>不显示图标</button> : null}
    <div className="icon-picker-grid" role="group" aria-label="本地图标库">
      {visible.map((icon) => <button key={icon.id} type="button" aria-label={icon.label} aria-pressed={value === icon.id} disabled={disabled} onClick={() => onChange(icon.id)}><LocalIcon name={icon.id} size={22} /><span>{icon.label}</span></button>)}
    </div>
    {visible.length === 0 ? <p role="status">没有匹配的图标，请更换关键词或分类。</p> : null}
  </div>;
}
