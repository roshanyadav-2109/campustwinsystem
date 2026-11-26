"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { saveBus, saveRoute, saveRun, saveStops, type StopInput } from "@/app/dashboard/settings/transport/actions";

export type BusRow = { id: number; code: string; registrationNo: string | null; capacity: number | null; active: boolean };
export type RouteRow = { id: number; code: string; name: string; notes: string | null; active: boolean; annualFee: number; stops: StopInput[] };
export type RunRow = { id: number; busId: number; routeId: number; driverId: number | null; conductorId: number | null; active: boolean };
export type StaffOpt = { id: number; name: string; role: string };

type Msg = { text: string; ok: boolean } | null;
const Note = ({ msg }: { msg: Msg }) =>
  msg ? <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p> : null;

// Reads a location out of whatever a person pastes: a Google Maps address-bar
// link (…/@18.52,73.85,17z or ?q=18.52,73.85 or !3d18.52!4d73.85) or "18.52, 73.85".
export function parseLocation(raw: string): { lat: number; lng: number } | null {
  const s = raw.trim();
  const pats = [/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export function TransportSetup({ buses, routes, runs, staff }: { buses: BusRow[]; routes: RouteRow[]; runs: RunRow[]; staff: StaffOpt[] }) {
  return (
    <div className="space-y-5">
      <BusesCard buses={buses} />
      <RoutesCard routes={routes} />
      <RunsCard runs={runs} buses={buses} routes={routes} staff={staff} />
    </div>
  );
}

// ------------------------------------------------------------------ buses
function BusesCard({ buses }: { buses: BusRow[] }) {
  const id = useId();
  const blank = { id: null as number | null, code: "", reg: "", cap: "", active: true };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveBus({ id: f.id, code: f.code, registrationNo: f.reg, capacity: f.cap ? Number(f.cap) : null, active: f.active });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: f.id ? "Bus saved." : "Bus added.", ok: true }); setF(blank);
    });
  }
  return (
    <Card>
      <CardHeader title={`Buses (${buses.length})`} />
      <CardBody className="pt-1">
        {buses.length > 0 && (
          <ul className="mb-4 divide-y divide-hair">
            {buses.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className={`text-[14px] font-medium ${b.active ? "text-ink-900" : "text-ink-500 line-through"}`}>Bus {b.code}</span>
                  <span className="ml-2 text-[13px] text-ink-500">{[b.registrationNo, b.capacity ? `${b.capacity} seats` : null, b.active ? null : "not in use"].filter(Boolean).join(" · ")}</span>
                </div>
                <Button size="sm" variant="subtle" onClick={() => { setMsg(null); setF({ id: b.id, code: b.code, reg: b.registrationNo ?? "", cap: b.capacity ? String(b.capacity) : "", active: b.active }); }}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[120px_1fr_110px_auto] sm:items-end">
          <Field label="Bus number" htmlFor={`${id}-c`}><Input id={`${id}-c`} value={f.code} maxLength={12} placeholder="B3" onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Registration (optional)" htmlFor={`${id}-r`}><Input id={`${id}-r`} value={f.reg} maxLength={20} placeholder="MH12 AB 1234" onChange={(e) => setF({ ...f, reg: e.target.value })} /></Field>
          <Field label="Seats" htmlFor={`${id}-s`}><Input id={`${id}-s`} type="number" min={1} max={120} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} /></Field>
          <div className="flex items-center gap-2 pb-0.5">
            {f.id && (
              <label className="flex items-center gap-1.5 text-[13px] text-ink-700"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label>
            )}
            <Button onClick={save} disabled={pending || !f.code.trim()}>{pending ? "Saving…" : f.id ? "Save" : "Add bus"}</Button>
            {f.id && <Button variant="subtle" onClick={() => setF(blank)}>Cancel</Button>}
          </div>
        </div>
        <div className="mt-2"><Note msg={msg} /></div>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ routes and stops
function RoutesCard({ routes }: { routes: RouteRow[] }) {
  const id = useId();
  const [open, setOpen] = useState<number | null>(routes[0]?.id ?? null);
  const blank = { id: null as number | null, code: "", name: "", notes: "", active: true, fee: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveRoute({ id: f.id, code: f.code, name: f.name, notes: f.notes, active: f.active, annualFee: Number(f.fee || 0) });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: f.id ? "Route saved." : "Route added. Now add its stops.", ok: true });
      if (!f.id && res.id) setOpen(res.id);
      setF(blank);
    });
  }
  const current = routes.find((r) => r.id === open) ?? null;
  return (
    <Card>
      <CardHeader title={`Routes and stops (${routes.length})`} />
      <CardBody className="pt-1">
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div>
            <ul className="space-y-1">
              {routes.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setOpen(r.id); setMsg(null); }} aria-pressed={open === r.id}
                    className={`w-full rounded-sm border px-3 py-2 text-left text-[14px] ${open === r.id ? "border-[#0F6CBD] bg-[#EBF3FC]" : "border-hair hover:bg-panel"}`}>
                    <span className={`font-medium ${r.active ? "text-ink-900" : "text-ink-500 line-through"}`}>{r.code} {r.name}</span>
                    <span className="block text-[12px] text-ink-500">{r.stops.length} stop{r.stops.length === 1 ? "" : "s"}{r.annualFee ? ` · ₹${r.annualFee.toLocaleString("en-IN")} a year` : ""}{r.active ? "" : " · not in use"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2 border-t border-hair pt-3">
              <div className="text-[13px] font-semibold text-ink-900">{f.id ? "Change route" : "New route"}</div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <Field label="Code" htmlFor={`${id}-rc`}><Input id={`${id}-rc`} value={f.code} maxLength={12} placeholder="R3" onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
                <Field label="Route name" htmlFor={`${id}-rn`}><Input id={`${id}-rn`} value={f.name} maxLength={80} placeholder="Baner and Aundh" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              </div>
              <Field label="Transport fee for the year (₹)" htmlFor={`${id}-rf`} hint="Added to the fee instalments of every student on this route. 0 for none.">
                <Input id={`${id}-rf`} inputMode="decimal" value={f.fee} placeholder="0" onChange={(e) => setF({ ...f, fee: e.target.value })} />
              </Field>
              {f.id && <label className="flex items-center gap-1.5 text-[13px] text-ink-700"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label>}
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={pending || !f.code.trim() || !f.name.trim()}>{f.id ? "Save route" : "Add route"}</Button>
                {f.id && <Button size="sm" variant="subtle" onClick={() => setF(blank)}>Cancel</Button>}
                {!f.id && current && <Button size="sm" variant="subtle" onClick={() => setF({ id: current.id, code: current.code, name: current.name, notes: current.notes ?? "", active: current.active, fee: current.annualFee ? String(current.annualFee) : "" })}>Edit {current.code}</Button>}
              </div>
              <Note msg={msg} />
            </div>
          </div>
          {current ? <StopsEditor key={current.id} route={current} /> : <p className="text-[13px] text-ink-500">Add a route, then its stops.</p>}
        </div>
      </CardBody>
    </Card>
  );
}

type StopDraft = { id: number | null; name: string; landmark: string; lat: string; lng: string; am: string; pm: string };
const toDraft = (s: StopInput): StopDraft => ({ id: s.id, name: s.name, landmark: s.landmark, lat: s.lat == null ? "" : String(s.lat), lng: s.lng == null ? "" : String(s.lng), am: s.am, pm: s.pm });

function StopsEditor({ route }: { route: RouteRow }) {
  const id = useId();
  const [stops, setStops] = useState<StopDraft[]>(route.stops.map(toDraft));
  const [paste, setPaste] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<StopDraft>) => setStops((a) => a.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setStops((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });

  function here(i: number) {
    setMsg(null);
    if (!navigator.geolocation) { setMsg({ text: "This device cannot share its location. Paste a Google Maps link instead.", ok: false }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => set(i, { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }),
      () => setMsg({ text: "Location was not shared. Allow location for this site, or paste a Google Maps link.", ok: false }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  function usePaste(i: number, raw: string) {
    setPaste((p) => ({ ...p, [i]: raw }));
    const loc = parseLocation(raw);
    if (loc) set(i, { lat: loc.lat.toFixed(6), lng: loc.lng.toFixed(6) });
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveStops(route.id, stops.map((s) => ({ id: s.id, name: s.name, landmark: s.landmark, lat: s.lat === "" ? null : Number(s.lat), lng: s.lng === "" ? null : Number(s.lng), am: s.am, pm: s.pm })));
      setMsg(res.ok ? { text: "Stops saved. Distances along the route were worked out from their locations.", ok: true } : { text: res.error, ok: false });
    });
  }

  return (
    <div>
      <div className="mb-2 text-[14px] font-semibold text-ink-900">{route.code} {route.name}: stops in the order the bus reaches them</div>
      {stops.length === 0 && <p className="mb-2 text-[13px] text-ink-500">No stops yet. Start with the first pick-up point.</p>}
      <ol className="space-y-3">
        {stops.map((s, i) => {
          const located = s.lat !== "" && s.lng !== "";
          return (
            <li key={s.id ?? `new-${i}`} className="rounded-sm border border-hair p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel text-[12px] font-semibold text-ink-900">{i + 1}</span>
                <div className="min-w-[180px] flex-1"><Input aria-label={`Stop ${i + 1} name`} value={s.name} maxLength={80} placeholder="Stop name, like Baner Gaon" onChange={(e) => set(i, { name: e.target.value })} /></div>
                <Button size="sm" variant="subtle" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move stop ${i + 1} up`}>Up</Button>
                <Button size="sm" variant="subtle" onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label={`Move stop ${i + 1} down`}>Down</Button>
                <Button size="sm" variant="subtle" onClick={() => setStops((a) => a.filter((_, j) => j !== i))} aria-label={`Remove stop ${i + 1}`}>Remove</Button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_110px_110px]">
                <Input aria-label={`Stop ${i + 1} landmark`} value={s.landmark} maxLength={120} placeholder="Landmark (optional)" onChange={(e) => set(i, { landmark: e.target.value })} />
                <Field label="Morning" htmlFor={`${id}-am-${i}`}><Input id={`${id}-am-${i}`} type="time" value={s.am} onChange={(e) => set(i, { am: e.target.value })} /></Field>
                <Field label="Afternoon" htmlFor={`${id}-pm-${i}`}><Input id={`${id}-pm-${i}`} type="time" value={s.pm} onChange={(e) => set(i, { pm: e.target.value })} /></Field>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="subtle" onClick={() => here(i)}>Use my location</Button>
                <div className="min-w-[220px] flex-1"><Input aria-label={`Stop ${i + 1} Google Maps link`} value={paste[i] ?? ""} placeholder="or paste a Google Maps link" onChange={(e) => usePaste(i, e.target.value)} /></div>
                <span className={`text-[12px] ${located ? "text-up" : "text-down"}`}>{located ? `Location set (${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)})` : "Location needed"}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="subtle" onClick={() => setStops((a) => [...a, { id: null, name: "", landmark: "", lat: "", lng: "", am: "", pm: "" }])}>Add a stop</Button>
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save stops"}</Button>
        <Note msg={msg} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ runs this year
function RunsCard({ runs, buses, routes, staff }: { runs: RunRow[]; buses: BusRow[]; routes: RouteRow[]; staff: StaffOpt[] }) {
  const id = useId();
  const blank = { id: null as number | null, bus: "", route: "", driver: "", conductor: "", active: true };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const busName = (bid: number) => `Bus ${buses.find((b) => b.id === bid)?.code ?? ""}`;
  const routeName = (rid: number) => { const r = routes.find((x) => x.id === rid); return r ? `${r.code} ${r.name}` : ""; };
  const staffName = (sid: number | null) => (sid ? staff.find((s) => s.id === sid)?.name ?? "" : "");
  const crewFirst = [...staff].sort((a, b) => Number(b.role === "transport") - Number(a.role === "transport") || a.name.localeCompare(b.name));
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveRun({ id: f.id, busId: Number(f.bus), routeId: Number(f.route), driverId: Number(f.driver) || null, conductorId: Number(f.conductor) || null, active: f.active });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: "Saved.", ok: true }); setF(blank);
    });
  }
  const staffSelect = (label: string, key: "driver" | "conductor") => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <Select id={`${id}-${key}`} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
        <option value="">Not set</option>
        {crewFirst.map((s) => <option key={s.id} value={s.id}>{s.name}{s.role === "transport" ? " (transport)" : ""}</option>)}
      </Select>
    </Field>
  );
  return (
    <Card>
      <CardHeader title="Which bus runs which route this year" />
      <CardBody className="pt-1">
        {runs.length > 0 && (
          <ul className="mb-4 divide-y divide-hair">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1 text-[14px]">
                  <span className={`font-medium ${r.active ? "text-ink-900" : "text-ink-500 line-through"}`}>{busName(r.busId)} on {routeName(r.routeId)}</span>
                  <span className="ml-2 text-[13px] text-ink-500">{[r.driverId ? `Driver ${staffName(r.driverId)}` : "No driver", r.conductorId ? `Conductor ${staffName(r.conductorId)}` : "No conductor"].join(" · ")}</span>
                </div>
                <Button size="sm" variant="subtle" onClick={() => { setMsg(null); setF({ id: r.id, bus: String(r.busId), route: String(r.routeId), driver: r.driverId ? String(r.driverId) : "", conductor: r.conductorId ? String(r.conductorId) : "", active: r.active }); }}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Bus" htmlFor={`${id}-b`}>
            <Select id={`${id}-b`} value={f.bus} onChange={(e) => setF({ ...f, bus: e.target.value })}>
              <option value="">Choose</option>
              {buses.filter((b) => b.active || String(b.id) === f.bus).map((b) => <option key={b.id} value={b.id}>Bus {b.code}</option>)}
            </Select>
          </Field>
          <Field label="Route" htmlFor={`${id}-r`}>
            <Select id={`${id}-r`} value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })}>
              <option value="">Choose</option>
              {routes.filter((r) => r.active || String(r.id) === f.route).map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
            </Select>
          </Field>
          {staffSelect("Driver", "driver")}
          {staffSelect("Conductor", "conductor")}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {f.id && <label className="flex items-center gap-1.5 text-[13px] text-ink-700"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Running this year</label>}
          <Button onClick={save} disabled={pending || !f.bus || !f.route}>{pending ? "Saving…" : f.id ? "Save" : "Add"}</Button>
          {f.id && <Button variant="subtle" onClick={() => setF(blank)}>Cancel</Button>}
          <Note msg={msg} />
        </div>
        <p className="mt-2 text-[12px] text-ink-500">The conductor runs the trip from their phone (Transport, Conductor), which shares the bus&apos;s live position with families.</p>
      </CardBody>
    </Card>
  );
}
