import { useEffect, useState, type InputHTMLAttributes } from "react";

export function NumberField({ value, onCommit, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: number; onCommit: (value: number) => void }) {
  const [draft,setDraft] = useState(String(value)); useEffect(() => setDraft(String(value)),[value]);
  return <input {...props} type="number" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => {
    const number = Number(draft); if (!draft.trim() || !Number.isFinite(number)) setDraft(String(value)); else if (number !== value) onCommit(number);
  }} />;
}
