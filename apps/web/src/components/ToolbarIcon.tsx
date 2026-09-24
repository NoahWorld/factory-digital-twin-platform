type ToolbarIconName = "template" | "data" | "delete" | "preview" | "save";

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <svg aria-hidden="true" className="toolbar-icon" focusable="false" viewBox="0 0 24 24">
      {name === "template" ? <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></> : null}
      {name === "data" ? <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></> : null}
      {name === "delete" ? <><path d="M4.5 7h15M9 7V4.5h6V7m-8.8 0 .8 12.5h10l.8-12.5M10 10.5v6M14 10.5v6" /></> : null}
      {name === "preview" ? <><path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" /></> : null}
      {name === "save" ? <><path d="M4 3.5h13l3 3v14H4zM7.5 3.5v6h9v-6M7 20.5v-7h10v7" /><path d="M13.5 3.5v4" /></> : null}
    </svg>
  );
}
