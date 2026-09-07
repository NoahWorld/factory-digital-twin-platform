import { memo } from "react";
import { getIcon, type IconId } from "../../../../shared/icon-catalog";

export const LocalIcon = memo(function LocalIcon({ name, size = 24, color = "currentColor", strokeWidth = 1.8, rotation = 0 }: {
  name: IconId; size?: number; color?: string; strokeWidth?: number; rotation?: number;
}) {
  const icon = getIcon(name);
  return <svg aria-hidden="true" focusable="false" className="local-vector-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rotation}deg)` }} dangerouslySetInnerHTML={{ __html: icon.body }} />;
});
