"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";

// Transport setup: buses, routes with their stops, and which bus runs which
// route this year with its driver and conductor. The principal and the office
// keep it (the database allows the same). Distances along a route are worked
// out from the stop locations; nobody types them.

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const code = (v: unknown) => text(v, 12).toUpperCase().replace(/[^A-Z0-9-]/g, "");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function leader() {
  const s = await getSession();
  return s?.staffId && (s.staffRole === "principal" || s.staffRole === "office") ? s : null;
}
const NOT_ALLOWED = fail("Only the principal or the office can change transport setup.");
function refresh() {
  revalidatePath("/dashboard/transport/setup");
  revalidatePath("/dashboard/transport");
  revalidatePath("/dashboard/transport/riders");
}

// ------------------------------------------------------------------ buses
export type BusInput = { id: number | null; code: string; registrationNo: string; capacity: number | null; active: boolean };
export async function saveBus(input: BusInput): Promise<Result> {
  if (!(await leader())) return NOT_ALLOWED;
  const c = code(input?.code);
  if (!c) return fail("Give the bus a short number, like B1.");
  const capacity = input?.capacity == null || Number.isNaN(Number(input.capacity)) ? null : Math.round(Number(input.capacity));
  if (capacity !== null && (capacity < 1 || capacity > 120)) return fail("Seats should be between 1 and 120.");
  const row = { code: c, registration_no: text(input?.registrationNo, 20).toUpperCase() || null, capacity, is_active: input?.active !== false };
  const supabase = await createClient();
  const { data: clash } = await supabase.from("bus").select("id").eq("code", c);
  if ((clash ?? []).some((b) => b.id !== input?.id)) return fail(`Bus ${c} already exists.`);
  const res = input?.id
    ? await supabase.from("bus").update(row).eq("id", input.id).select("id")
    : await supabase.from("bus").insert(row).select("id");
  if (res.error || !res.data?.length) return fail("The bus could not be saved. Please try again.");
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ routes
export type RouteInput = { id: number | null; code: string; name: string; notes: string; active: boolean; annualFee?: number };
export async function saveRoute(input: RouteInput): Promise<Result & { id?: number }> {
  if (!(await leader())) return NOT_ALLOWED;
  const c = code(input?.code);
  const name = text(input?.name, 80);
  if (!c) return fail("Give the route a short code, like R1.");
  if (!name) return fail("Give the route a name, like Baner and Aundh.");
  const fee = input?.annualFee == null ? 0 : Number(input.annualFee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) return fail("Enter the transport fee for the year as an amount in rupees, or 0.");
  const row = { code: c, name, notes: text(input?.notes, 300) || null, is_active: input?.active !== false, annual_fee: Math.round(fee * 100) / 100 };
  const supabase = await createClient();
  const { data: clash } = await supabase.from("route").select("id").eq("code", c);
  if ((clash ?? []).some((r) => r.id !== input?.id)) return fail(`Route ${c} already exists.`);
  const res = input?.id
    ? await supabase.from("route").update(row).eq("id", input.id).select("id")
    : await supabase.from("route").insert(row).select("id");
  if (res.error || !res.data?.length) return fail("The route could not be saved. Please try again.");
  refresh();
  return { ok: true, id: res.data[0].id };
}

// ------------------------------------------------------------------ stops
export type StopInput = { id: number | null; name: string; landmark: string; lat: number | null; lng: number | null; am: string; pm: string };

const R = 6_371_000;
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Saves a route's stops in the order given: new ones added, removed ones taken
// out (unless a student is booked on them), the rest updated. The distance from
// the first stop is computed for each.
export async function saveStops(routeId: number, stops: StopInput[]): Promise<Result> {
  if (!(await leader())) return NOT_ALLOWED;
  if (!Array.isArray(stops) || stops.length > 80) return fail("A route can have at most 80 stops.");
  const clean: (StopInput & { lat: number; lng: number })[] = [];
  for (const [i, s] of stops.entries()) {
    const name = text(s?.name, 80);
    if (!name) return fail(`Stop ${i + 1} needs a name.`);
    const lat = Number(s?.lat), lng = Number(s?.lng);
    if (s?.lat == null || s?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      return fail(`Set the location of ${name}: use your location at the stop, or paste a Google Maps link.`);
    }
    if (s.am && !TIME.test(s.am)) return fail(`The morning time for ${name} does not look right.`);
    if (s.pm && !TIME.test(s.pm)) return fail(`The afternoon time for ${name} does not look right.`);
    clean.push({ ...s, name, landmark: text(s.landmark, 120), lat, lng });
  }

  const supabase = await createClient();
  const { data: route } = await supabase.from("route").select("id").eq("id", routeId).maybeSingle();
  if (!route) return fail("That route was not found.");
  const { data: existing } = await supabase.from("route_stop").select("id, name").eq("route_id", routeId);
  const keep = new Set(clean.filter((s) => s.id).map((s) => s.id));
  const removed = (existing ?? []).filter((e) => !keep.has(e.id));
  if (removed.length) {
    const ids = removed.map((r) => r.id);
    const { data: booked } = await supabase.from("student_transport").select("pickup_stop_id, drop_stop_id")
      .eq("is_active", true).or(`pickup_stop_id.in.(${ids.join(",")}),drop_stop_id.in.(${ids.join(",")})`);
    const used = new Set((booked ?? []).flatMap((b) => [b.pickup_stop_id, b.drop_stop_id]));
    const blocked = removed.find((r) => used.has(r.id));
    if (blocked) return fail(`${blocked.name} still has students booked on it. Move them to another stop in Bus Riders first.`);
    const { error } = await supabase.from("route_stop").delete().in("id", ids);
    if (error) return fail("A removed stop could not be taken out. Please try again.");
  }

  // Step 1: move kept stops out of the way of the new order.
  for (const [i, s] of clean.entries()) {
    if (!s.id) continue;
    const { error } = await supabase.from("route_stop").update({ seq: 1000 + i }).eq("id", s.id).eq("route_id", routeId);
    if (error) return fail("The stops could not be reordered. Please try again.");
  }
  // Step 2: write every stop in its final place.
  let cum = 0;
  for (const [i, s] of clean.entries()) {
    if (i > 0) cum += metres(clean[i - 1], s);
    const row = {
      seq: i + 1, name: s.name, landmark: s.landmark || null, lat: s.lat, lng: s.lng,
      sched_am: s.am || null, sched_pm: s.pm || null, cum_distance_m: Math.round(cum),
    };
    const res = s.id
      ? await supabase.from("route_stop").update(row).eq("id", s.id).eq("route_id", routeId)
      : await supabase.from("route_stop").insert({ ...row, route_id: routeId });
    if (res.error) return fail(`${s.name} could not be saved. Please try again.`);
  }
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ runs this year
export type RunInput = { id: number | null; busId: number; routeId: number; driverId: number | null; conductorId: number | null; active: boolean };
export async function saveRun(input: RunInput): Promise<Result> {
  if (!(await leader())) return NOT_ALLOWED;
  const year = await getCurrentYear();
  if (!year) return fail("No school year is set up yet.");
  if (!input?.busId || !input?.routeId) return fail("Choose the bus and the route.");
  if (input.driverId && input.driverId === input.conductorId) return fail("The driver and the conductor should be different people.");
  const supabase = await createClient();
  const active = input.active !== false;
  if (active) {
    const { data: busy } = await supabase.from("bus_assignment").select("id, route:route(name)")
      .eq("bus_id", input.busId).eq("academic_year_id", year.id).eq("is_active", true);
    const other = (busy ?? []).find((b) => b.id !== input.id);
    if (other) return fail(`That bus already runs ${(other.route as { name?: string } | null)?.name ?? "another route"} this year. Switch that off first.`);
  }
  const row = { bus_id: input.busId, route_id: input.routeId, driver_staff_id: input.driverId, conductor_staff_id: input.conductorId, is_active: active };
  const res = input.id
    ? await supabase.from("bus_assignment").update(row).eq("id", input.id).select("id")
    : await supabase.from("bus_assignment").insert({ ...row, academic_year_id: year.id }).select("id");
  if (res.error || !res.data?.length) {
    return fail(res.error?.code === "23505" ? "That bus is already set for this route this year." : "This could not be saved. Please try again.");
  }
  refresh();
  return { ok: true };
}
