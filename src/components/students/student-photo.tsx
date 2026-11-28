"use client";
import { useState } from "react";
import { PhotoUpload } from "@/components/photo-upload";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { signStudentPhoto, saveStudentPhoto, removeStudentPhoto, studentsByAdmission } from "@/app/dashboard/students/[id]/photo-actions";

// The office or class teacher sets a student's photo (printed on ID cards, report cards and admit cards).
export function StudentPhoto({ studentId, url, name }: { studentId: number; url: string | null; name: string }) {
  return <PhotoUpload url={url} name={name} sign={(ct) => signStudentPhoto(studentId, ct)} save={(u) => saveStudentPhoto(studentId, u)} remove={() => removeStudentPhoto(studentId)} />;
}

// Many photos at once, each file named by the admission number (e.g. GFP260012.jpg).
export function PhotoBulkUpload() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const run = async (files: File[]) => {
    setBusy(true); setLog([]);
    const nameOf = (f: File) => f.name.replace(/\.[^.]+$/, "").trim().toUpperCase();
    const ids = await studentsByAdmission(files.map(nameOf));
    let done = 0, skipped = 0; const bad: string[] = [];
    for (const f of files) {
      const s = ids[nameOf(f)];
      if (!s) { bad.push(`${f.name}: no student with admission no. ${nameOf(f)}`); continue; }
      if (s.hasPhoto && !replace) { skipped++; continue; }
      if (!/^image\/(jpeg|png)$/.test(f.type) || f.size > 8 * 1024 * 1024) { bad.push(`${f.name}: use a JPEG or PNG under 8 MB`); continue; }
      const t = await signStudentPhoto(s.id, f.type);
      if (!t.ok) { bad.push(`${f.name}: ${t.error}`); continue; }
      const put = await fetch(t.uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
      if (!put.ok) { bad.push(`${f.name}: upload failed`); continue; }
      const r = await saveStudentPhoto(s.id, t.publicUrl);
      if (r.ok) done++; else bad.push(`${f.name}: ${r.error}`);
      setLog([`${done} saved so far…`]);
    }
    setLog([`${done} photo${done === 1 ? "" : "s"} saved${skipped ? `, ${skipped} skipped (already have a photo)` : ""}.`, ...bad]);
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader title="Student photos" />
      <CardBody className="space-y-2 text-[13px]">
        <p className="text-ink-700">Choose many photos at once. Name each file by the admission number, for example GFP260012.jpg. Photos print on ID cards, report cards and admit cards.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace photos students already have</label>
        <input type="file" multiple accept="image/jpeg,image/png" aria-label="Student photos" disabled={busy} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void run(fs); }} />
        {log.length > 0 && <ul className="max-h-48 overflow-auto text-[12px] text-ink-700">{log.map((l, i) => <li key={i} className={i ? "text-down" : "font-medium text-ink-900"}>{l}</li>)}</ul>}
      </CardBody>
    </Card>
  );
}
