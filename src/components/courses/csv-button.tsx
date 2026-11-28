"use client";

// Download rows as a CSV that opens straight in Excel (UTF-8 with a byte-order mark).
export function CsvButton({ filename, headers, rows, label = "Download CSV" }: { filename: string; headers: string[]; rows: (string | number | null)[][]; label?: string }) {
  const esc = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const save = () => {
    const text = "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };
  return <button onClick={save} className="h-8 rounded-sm border border-hair bg-white px-3 text-[13px] text-ink-900 hover:bg-panel">{label}</button>;
}
