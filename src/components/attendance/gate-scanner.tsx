"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { scanCard } from "@/app/dashboard/staff-attendance/actions";

type Hit = { at: string; ok: boolean; message: string; student: string | null; cls: string | null; photo?: string | null };
type Detector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };

// Uses the phone's camera with the browser's own QR reader (Chrome on Android
// and most phones). Where that is not available, the code can be typed or pasted.
export function GateScanner() {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [manual, setManual] = useState("");
  const [pending, start] = useTransition();
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => { setSupported(typeof window !== "undefined" && "BarcodeDetector" in window); }, []);

  const handle = (code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 4000) return;   // the same card held in front of the camera
    last.current = { code, at: now };
    start(async () => {
      const r = await scanCard(code);
      setHits((h) => [{ at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), ok: r.ok, message: r.message, student: r.student, cls: r.cls, photo: r.photo }, ...h].slice(0, 50));
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(r.ok ? 60 : [80, 60, 80]);
    });
  };

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null; let stop = false; let timer: ReturnType<typeof setTimeout>;
    const W = window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector };
    const detector = new W.BarcodeDetector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const tick = async () => {
          if (stop || !video.current) return;
          try { const found = await detector.detect(video.current); if (found[0]?.rawValue) handle(found[0].rawValue); } catch { /* frame not ready */ }
          timer = setTimeout(tick, 350);
        };
        tick();
      } catch { setOn(false); setHits((h) => [{ at: "", ok: false, message: "The camera could not be opened. Allow camera access, or type the code below.", student: null, cls: null }, ...h]); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Camera" />
        <CardBody className="space-y-3">
          {supported === false && <p className="text-[13px] text-ink-700">This browser cannot read QR codes from the camera. Use Chrome on an Android phone, or type the code from the card below.</p>}
          {supported && (
            <>
              <video ref={video} playsInline muted className={`aspect-[4/3] w-full rounded-md bg-ink-900 object-cover ${on ? "" : "hidden"}`} />
              <Button onClick={() => setOn(!on)}>{on ? "Stop camera" : "Start scanning"}</Button>
            </>
          )}
          <div className="flex gap-2 border-t border-hair pt-3">
            <Input aria-label="Card code" placeholder="Code or link from the card" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button variant="subtle" disabled={pending || !manual.trim()} onClick={() => { handle(manual.trim()); setManual(""); }}>Mark</Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        {hits[0]?.student && (
          <div className="flex items-center gap-4 border-b border-hair p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- the school's own photo */}
            {hits[0].photo ? <img src={hits[0].photo} alt={`Photo of ${hits[0].student}`} className="h-32 w-24 rounded-md object-cover" /> : <div className="flex h-32 w-24 items-center justify-center rounded-md bg-panel text-[11px] text-ink-500">No photo</div>}
            <div><p className="text-[18px] font-semibold text-ink-900">{hits[0].student}</p><p className="text-[13px] text-ink-700">{hits[0].cls}</p>
              <p className="mt-1 text-[12px] text-ink-500">Check the face matches before letting the child in. A photo on a phone screen can be a screenshot.</p></div>
          </div>
        )}
        <CardHeader title="Scanned" action={<span className="text-[12px] text-ink-500">{hits.filter((h) => h.ok).length} marked</span>} />
        <CardBody className="p-0">
          {hits.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nothing scanned yet.</p> : (
            <ul aria-live="polite">{hits.map((h, i) => (
              <li key={i} className={`border-b border-hair px-4 py-2 text-[13px] last:border-b-0 ${i === 0 ? "bg-[#fafafa]" : ""}`}>
                <span className={`font-medium ${h.ok ? "text-up" : "text-down"}`}>{h.message}</span>
                {h.student && <span className="text-ink-900">: {h.student}{h.cls ? `, ${h.cls}` : ""}</span>}
                {h.at && <span className="ml-2 text-[11px] text-ink-500">{h.at}</span>}
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
