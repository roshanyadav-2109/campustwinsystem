import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDelivery, type Delivery } from "@/core/notifications/providers";

// Sends waiting messages. Called every minute by the database (pg_cron + pg_net)
// with the shared dispatch key; never by a browser.
export async function POST(request: NextRequest) {
  const key = process.env.NOTIFY_DISPATCH_KEY ?? "";
  const given = request.headers.get("x-dispatch-key") ?? "";
  const a = Buffer.from(given), b = Buffer.from(key);
  const same = b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
  if (!same) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();
  let sent = 0, failed = 0;
  const started = Date.now();
  // Work for up to ~20 seconds per call; the database calls again every minute.
  for (let round = 0; round < 40 && Date.now() - started < 20000; round++) {
    const { data, error } = await admin.rpc("take_deliveries" as never, { p_limit: 25 } as never);
    if (error) return NextResponse.json({ error: "could not read the queue" }, { status: 500 });
    const batch = (data ?? []) as Delivery[];
    if (!batch.length) break;
    const results = await Promise.all(batch.map(async (d) => ({ d, r: await sendDelivery(d) })));
    for (const { d, r } of results) {
      await admin.rpc("delivery_result" as never, { p_id: d.id, p_ok: r.ok, p_ref: r.ok ? r.ref : null, p_error: r.ok ? null : r.error } as never);
      if (r.ok) sent++; else failed++;
    }
  }
  return NextResponse.json({ sent, failed });
}
