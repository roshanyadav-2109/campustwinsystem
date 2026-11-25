import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/context";
import { fyOf } from "@/lib/format";

// Donor report for a financial year: one row per recorded donation, with the
// details the annual statement of donations asks for (donor id, type of
// donation, mode, amount). Staff only.
export async function GET(request: NextRequest) {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return new NextResponse("Not allowed", { status: 403 });
  const y = request.nextUrl.searchParams.get("fy") ?? "";
  if (!/^\d{4}$/.test(y)) return new NextResponse("Choose a year", { status: 400 });
  const fy = fyOf(`${y}-04-01`);
  const { data } = await db.from("donation")
    .select("receipt_number, donated_on, donor_name, donor_pan, donor_address, donor_citizenship, amount, mode, reference, eligible_80g, campaign:campaign!donation_org_id_campaign_id_fkey(title, fund_type)")
    .eq("org_id", org.id).eq("status", "recorded").gte("donated_on", fy.start).lte("donated_on", fy.end).order("donated_on").limit(50000);

  // Spreadsheet-safe: quote every cell and neutralise leading formula characters.
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["Receipt number", "Date", "Donor name", "Donor PAN", "Donor address", "Donor is", "Type of donation", "Campaign", "Mode", "Reference", "Amount", "80G receipt issued"];
  const lines = (data ?? []).map((d) => {
    const c = d.campaign as unknown as { title: string; fund_type: string } | null;
    const type = c?.fund_type === "corpus" ? "Corpus" : c?.fund_type === "specific" ? "Specific grant" : "Others";
    return [d.receipt_number, d.donated_on, d.donor_name, d.donor_pan, d.donor_address, d.donor_citizenship, type, c?.title, d.mode, d.reference, Number(d.amount).toFixed(2), d.eligible_80g ? "Yes" : "No"].map(cell).join(",");
  });
  const csv = "﻿" + [head.map(cell).join(","), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="donor-report-${fy.label}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
