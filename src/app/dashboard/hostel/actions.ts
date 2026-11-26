"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

type R = { ok: true; message?: string } | { ok: false; error: string };
const office = async () => (await getSession())?.staffRole === "office";
const err = (e: { message: string } | null, f: string) => (e && e.message.length < 120 && !e.message.includes("violates") ? e.message : f);

export async function addHostel(name: string, kind: string, warden: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the hostel." };
  if (!name.trim()) return { ok: false, error: "Give the hostel a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("hostel" as never).insert({ name: name.trim().slice(0, 60), kind: ["boys", "girls"].includes(kind) ? kind : "mixed", warden: warden.trim().slice(0, 80) || null } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "A hostel with this name exists." : "Could not add." };
  revalidatePath("/dashboard/hostel");
  return { ok: true, message: "Added." };
}

export async function addRoom(hostelId: number, name: string, beds: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the hostel." };
  if (!name.trim() || !/^\d{1,2}$/.test(beds) || Number(beds) < 1) return { ok: false, error: "Give the room and its number of beds." };
  const supabase = await createClient();
  const { error } = await supabase.from("hostel_room" as never).insert({ hostel_id: hostelId, name: name.trim().slice(0, 30), beds: Number(beds) } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This room already exists." : err(error, "Could not add.") };
  revalidatePath("/dashboard/hostel");
  return { ok: true, message: "Room added." };
}

export async function allocate(roomId: number, bed: number, studentId: number): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can allot beds." };
  const supabase = await createClient();
  const { error } = await supabase.from("hostel_allocation" as never).insert({ room_id: roomId, bed_no: bed, student_id: studentId } as never);
  if (error) return { ok: false, error: error.message.includes("uq_hostel_student_active") ? "This student already has a bed. Move them out first." : error.message.includes("uq_hostel_bed_active") ? "This bed is taken." : err(error, "Could not allot.") };
  revalidatePath("/dashboard/hostel");
  return { ok: true, message: "Allotted." };
}

export async function moveOut(allocationId: number): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change beds." };
  const supabase = await createClient();
  const { error } = await supabase.from("hostel_allocation" as never).update({ to_date: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) } as never).eq("id", allocationId).is("to_date", null);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/dashboard/hostel");
  return { ok: true, message: "Moved out." };
}

export async function addItem(name: string, category: string, unit: string, min: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office keeps the stock." };
  if (!name.trim()) return { ok: false, error: "Give the item a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_item" as never).insert({ name: name.trim().slice(0, 80), category: category.trim().slice(0, 40) || null, unit: unit.trim().slice(0, 20) || "piece", min_stock: Number(min) || 0 } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This item exists." : "Could not add." };
  revalidatePath("/dashboard/inventory");
  return { ok: true, message: "Item added." };
}

export async function moveStock(itemId: number, kind: string, qty: string, person: string, note: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office keeps the stock." };
  if (!["received", "issued", "returned", "adjusted"].includes(kind) || !/^-?\d{1,6}(\.\d{1,2})?$/.test(qty) || Number(qty) === 0) return { ok: false, error: "Give how many." };
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_move" as never).insert({ item_id: itemId, kind, qty: Number(qty), person: person.trim().slice(0, 80) || null, note: note.trim().slice(0, 200) || null } as never);
  if (error) return { ok: false, error: err(error, "Could not save.") };
  revalidatePath("/dashboard/inventory");
  return { ok: true, message: "Saved." };
}
