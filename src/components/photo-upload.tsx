"use client";
/* eslint-disable @next/next/no-img-element -- R2/CDN already serves the image directly */
import { useRef, useState } from "react";

type Ticket = { ok: true; uploadUrl: string; publicUrl: string } | { ok: false; error: string };
type Res = { ok: true } | { ok: false; error: string };
const MAX = 8 * 1024 * 1024;

// A square photo with a small corner radius (not a circle). Uploads straight to
// R2 via a presigned URL, then records it; replacing or removing deletes the old
// object from storage server-side.
export function PhotoUpload({
  url, name, sign, save, remove,
}: {
  url: string | null;
  name?: string;
  sign: (contentType: string) => Promise<Ticket>;
  save: (publicUrl: string) => Promise<Res>;
  remove: () => Promise<Res>;
}) {
  const [current, setCurrent] = useState<string | null>(url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(f: File | null) {
    if (!f) return;
    setErr(null);
    if (!f.type.startsWith("image/")) { setErr("Please choose an image."); return; }
    if (f.size > MAX) { setErr("Image must be under 8 MB."); return; }
    setBusy(true);
    try {
      const t = await sign(f.type);
      if (!t.ok) throw new Error(t.error);
      const put = await fetch(t.uploadUrl, { method: "PUT", body: f, headers: { "content-type": f.type } });
      if (!put.ok) throw new Error("Upload failed, please try again.");
      const s = await save(t.publicUrl);
      if (!s.ok) throw new Error(s.error);
      setCurrent(`${t.publicUrl}?t=${Date.now()}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function onRemove() {
    setBusy(true); setErr(null);
    try {
      const r = await remove();
      if (!r.ok) throw new Error(r.error);
      setCurrent(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  }

  const initials = (name ?? "").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex items-center gap-4">
      {/* Square frame, gently rounded corners. */}
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hair bg-panel text-[22px] font-semibold text-ink-500">
        {current ? <img src={current} alt="" className="h-full w-full object-cover" /> : (initials || "—")}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        <div className="flex gap-2">
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] font-medium text-ink-900 hover:bg-panel disabled:opacity-50">
            {busy ? "Working…" : current ? "Change photo" : "Upload photo"}
          </button>
          {current && !busy && (
            <button type="button" onClick={onRemove}
              className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-700 hover:bg-panel">Remove</button>
          )}
        </div>
        <p className="text-[12px] text-muted">Square photo, up to 8 MB.</p>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
      </div>
    </div>
  );
}
