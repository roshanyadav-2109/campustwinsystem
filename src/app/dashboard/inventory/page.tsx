import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { InventoryDesk, type ItemRow, type MoveRow } from "@/components/operations/operations";

// Inventory: items, stock and every movement (received, issued, returned).
export default async function InventoryPage() {
  const denied = await guardTab("/dashboard/inventory");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [items, moves] = await Promise.all([
    supabase.from("inventory_item" as never).select("id, name, category, unit, min_stock, stock").order("name").limit(2000),
    supabase.from("inventory_move" as never).select("id, kind, qty, person, note, at, item:item_id(name, unit)").order("at", { ascending: false }).limit(100),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Inventory" description="Stock kept by the database from every movement; it can never go below zero, and the history cannot be edited." />
      <InventoryDesk items={(items.data ?? []) as unknown as ItemRow[]} moves={(moves.data ?? []) as unknown as MoveRow[]} canEdit={session?.staffRole === "office"} />
    </div>
  );
}
