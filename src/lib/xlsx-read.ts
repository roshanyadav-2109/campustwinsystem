// Minimal, dependency-free spreadsheet reader for uploads, in the browser.
// Reads the first sheet of an Excel .xlsx file, or a CSV file, into rows of
// text cells, so the office can upload the file Excel saves by default instead
// of being told to convert it. Dates come out as DD/MM/YYYY.
//
// An .xlsx file is a ZIP of XML parts; entries are deflated, which the browser
// can inflate natively (DecompressionStream "deflate-raw").

export class SpreadsheetError extends Error {}

type Entry = { name: string; method: number; compSize: number; localOffset: number };

function readEntries(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SpreadsheetError("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new SpreadsheetError("bad zip");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function entryText(buf: Uint8Array, e: Entry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const raw = buf.slice(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new SpreadsheetError("unsupported compression");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const tags = (d: Document | Element, name: string) => Array.from(d.getElementsByTagName(name));

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Excel stores a date as days since 30 Dec 1899.
function serialToDate(v: number): string {
  const ms = Math.round((v - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const entries = readEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (name: string) => { const e = byName.get(name); return e ? await entryText(buf, e) : null; };

  // First sheet, through the workbook's relationships.
  const wb = await read("xl/workbook.xml");
  if (!wb) throw new SpreadsheetError("no workbook");
  const firstSheet = tags(xml(wb), "sheet")[0];
  const rid = firstSheet?.getAttribute("r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (rid && rels) {
    const target = tags(xml(rels), "Relationship").find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }

  const shared: string[] = [];
  const ss = await read("xl/sharedStrings.xml");
  if (ss) for (const si of tags(xml(ss), "si")) shared.push(tags(si, "t").map((t) => t.textContent ?? "").join(""));

  // Which cell styles are dates (built-in date formats, or custom ones with d/m/y).
  const dateStyle = new Set<number>();
  const st = await read("xl/styles.xml");
  if (st) {
    const doc = xml(st);
    const custom = new Map(tags(doc, "numFmt").map((f) => [Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? ""]));
    const xfsParent = tags(doc, "cellXfs")[0];
    const xfs = xfsParent ? tags(xfsParent, "xf") : [];
    xfs.forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId") ?? 0);
      const code = (custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "").toLowerCase();
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[dmy]/.test(code) && !/^general$/.test(code))) dateStyle.add(i);
    });
  }

  const sheet = await read(sheetPath);
  if (!sheet) throw new SpreadsheetError("no sheet");
  const rows: string[][] = [];
  for (const row of tags(xml(sheet), "row")) {
    const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of tags(row, "c")) {
      const ref = c.getAttribute("r");
      const idx = ref ? colIndex(ref) : cells.length;
      const type = c.getAttribute("t");
      const v = tags(c, "v")[0]?.textContent ?? "";
      let out = "";
      if (type === "s") out = shared[Number(v)] ?? "";
      else if (type === "inlineStr") out = tags(c, "t").map((t) => t.textContent ?? "").join("");
      else if (type === "b") out = v === "1" ? "TRUE" : "FALSE";
      else if (type === "str" || type === "e") out = v;
      else if (v !== "") {
        const num = Number(v);
        const style = Number(c.getAttribute("s") ?? -1);
        out = dateStyle.has(style) && Number.isFinite(num) ? serialToDate(num) : Number.isFinite(num) ? String(num) : v;
      }
      cells[idx] = out;
    }
    rows[r] = Array.from(cells, (x) => x ?? "");
  }
  // Drop fully empty rows (including gaps left by skipped row numbers).
  return Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => c.trim() !== ""));
}

/** Rows of text from an uploaded .xlsx or .csv file. Throws SpreadsheetError with a plain message. */
export async function readSpreadsheet(file: File, parseCsv: (text: string) => string[][]): Promise<string[][]> {
  if (/\.xls$/i.test(file.name)) throw new SpreadsheetError("This is an old Excel file (.xls). In Excel, choose File, Save As, \"Excel Workbook (.xlsx)\", then upload that.");
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    try {
      return await readXlsx(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof SpreadsheetError && e.message.startsWith("This")) throw e;
      throw new SpreadsheetError("We could not read this Excel file. Please check it opens in Excel, or save it as CSV and try again.");
    }
  }
  if (/\.ods$/i.test(file.name)) throw new SpreadsheetError("This is an OpenOffice file. Save it as Excel (.xlsx) or CSV, then upload that.");
  return parseCsv(await file.text());
}
