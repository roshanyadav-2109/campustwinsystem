// Student ID cards as a printable PDF: standard CR80 cards (85.6 x 54 mm),
// eight to an A4 sheet with a thin outline to cut along. Each card: the
// institution's band, photo, name, class and roll, admission number, date of
// birth, blood group, a phone to call, the QR code that checks the card, and
// the year it is valid for. Runs in the browser (photos load from the CDN).
import type { IdCardSheet } from "@/app/dashboard/students/manage/id-card-actions";

const W = 85.6, H = 54, COLS = 2, ROWS = 4;
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
type QrFactory = (t: 0, l: "L" | "M" | "Q" | "H") => { addData: (d: string) => void; make: () => void; getModuleCount: () => number; isDark: (r: number, c: number) => boolean };

const clean = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const hex = (c: string): [number, number, number] => {
  const m = c.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [15, 108, 189];
};
const day = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

async function dataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

/** Names the card font cannot print (letters outside the Latin alphabet). */
export const unprintableNames = (sheet: IdCardSheet) => sheet.cards.filter((c) => clean(c.name) !== c.name).map((c) => c.name);

export async function downloadIdCards(sheet: IdCardSheet, filename: string) {
  const [{ jsPDF }, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const qr = ((qrMod as unknown as { default?: QrFactory }).default ?? (qrMod as unknown as QrFactory));
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const gapX = (pageW - COLS * W) / (COLS + 1), gapY = (pageH - ROWS * H) / (ROWS + 1);
  const band = hex(sheet.school.color);
  const [logo, ...photos] = await Promise.all([dataUrl(sheet.school.logoUrl), ...sheet.cards.map((c) => dataUrl(c.photoUrl))]);
  const fmt = (d: string) => (d.startsWith("data:image/png") ? "PNG" : "JPEG");

  sheet.cards.forEach((c, i) => {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.addPage();
    const x = gapX + (slot % COLS) * (W + gapX), y = gapY + Math.floor(slot / COLS) * (H + gapY);

    // outline to cut along
    doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.2); doc.roundedRect(x, y, W, H, 3, 3, "S");
    // institution band
    doc.setFillColor(...band); doc.roundedRect(x, y, W, 12, 3, 3, "F"); doc.rect(x, y + 6, W, 6, "F");
    let tx = x + 4;
    if (logo) { try { doc.addImage(logo, fmt(logo), x + 2.5, y + 1.8, 8.4, 8.4); tx = x + 12.5; } catch { /* no logo */ } }
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.2);
    doc.text(clean(sheet.school.name).slice(0, 42), tx, y + 5.4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.8);
    doc.text(clean([sheet.school.place, sheet.school.phone].filter(Boolean).join("  |  ")).slice(0, 60), tx, y + 9.4);

    // photo
    const px = x + 3.5, py = y + 15, pw = 19, ph = 24;
    const photo = photos[i];
    doc.setDrawColor(210, 210, 210); doc.rect(px, py, pw, ph, "S");
    if (photo) { try { doc.addImage(photo, fmt(photo), px, py, pw, ph); } catch { /* keep the box */ } }
    else {
      doc.setFillColor(240, 242, 245); doc.rect(px, py, pw, ph, "F");
      doc.setTextColor(120, 120, 120); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(clean(c.name).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(), px + pw / 2, py + ph / 2 + 2, { align: "center" });
    }

    // details
    const dx = x + 25.5;
    doc.setTextColor(20, 24, 39); doc.setFont("helvetica", "bold"); doc.setFontSize(8.6);
    doc.text(clean(c.name).slice(0, 26), dx, y + 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4);
    const lines: [string, string][] = [
      [sheet.classWord, `${c.classLabel}${c.rollNo ? `   Roll ${c.rollNo}` : ""}`],
      ["Adm. no.", c.admissionNo],
      ["Date of birth", day(c.dob)],
      ["Blood group", c.bloodGroup ?? ""],
      ["In emergency", c.phone ?? ""],
    ];
    lines.forEach(([k, v], j) => {
      doc.setTextColor(90, 98, 112); doc.text(clean(k), dx, y + 23 + j * 3.6);
      doc.setTextColor(20, 24, 39); doc.text(clean(v || "-").slice(0, 26), dx + 15.5, y + 23 + j * 3.6);
    });

    // QR code that checks the card
    const code = qr(0, "M"); code.addData(`https://verify.${BASE}/verify/${c.token}`); code.make();
    const n = code.getModuleCount(), size = 15.5, cell = size / n, qx = x + W - size - 3, qy = y + 15;
    doc.setFillColor(20, 24, 39);
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (code.isDark(r, k)) doc.rect(qx + k * cell, qy + r * cell, cell, cell, "F");
    doc.setFontSize(4.8); doc.setTextColor(90, 98, 112);
    doc.text("Scan to check", qx + size / 2, qy + size + 2.2, { align: "center" });

    // footer
    doc.setDrawColor(...band); doc.setLineWidth(0.6); doc.line(x + 3, y + H - 7.5, x + W - 3, y + H - 7.5);
    doc.setFontSize(6); doc.setTextColor(20, 24, 39); doc.setFont("helvetica", "bold");
    doc.text(clean(`Student ID card  |  Valid for ${sheet.yearName}`), x + 3.5, y + H - 3.6);
    doc.setFont("helvetica", "normal"); doc.setTextColor(90, 98, 112);
    doc.text(clean(sheet.school.signatory), x + W - 3.5, y + H - 3.6, { align: "right" });
  });
  doc.save(`${filename.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`);
}
