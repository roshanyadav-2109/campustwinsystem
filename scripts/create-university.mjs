// Onboard a university + its campuses in one command.
//   node scripts/create-university.mjs "<University Name>" <uni-slug> "Campus Name:campus-slug" ...
// e.g.
//   node scripts/create-university.mjs "SRM University" srm "SRM KTR:srmktr" "SRM Ramapuram:srmrmp"
//
// Creates the university row, each campus as a school row (linked + its own slug
// subdomain) with a current academic year so it is usable immediately, and copies
// the university's default module set onto each campus.
//
// Target DB: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment if set,
// otherwise from .env.local. (Point at live by exporting those two vars.)
import { readFileSync } from "node:fs";

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { URL: process.env.SUPABASE_URL, SERVICE: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  return { URL: env.NEXT_PUBLIC_SUPABASE_URL, SERVICE: env.SUPABASE_SERVICE_ROLE_KEY };
}

const { URL, SERVICE } = loadEnv();
const REST = `${URL}/rest/v1`;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function insert(table, row) {
  const r = await fetch(`${REST}/${table}`, { method: "POST", headers: H, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`INSERT ${table} -> ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}
async function getOne(path) {
  const r = await fetch(`${REST}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return (await r.json())[0] ?? null;
}

const [uniName, uniSlug, ...campusArgs] = process.argv.slice(2);
if (!uniName || !uniSlug || campusArgs.length === 0) {
  console.error('usage: node scripts/create-university.mjs "<University Name>" <uni-slug> "Campus Name:campus-slug" ...');
  process.exit(1);
}
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const YEAR = { name: "2025-26", start_date: "2025-04-01", end_date: "2026-03-31" };

const existing = await getOne(`university?slug=eq.${encodeURIComponent(uniSlug)}&select=id`);
if (existing) { console.error(`A university with slug "${uniSlug}" already exists (id ${existing.id}).`); process.exit(1); }

const uni = await insert("university", { name: uniName, slug: uniSlug });
console.log(`university: ${uni.name}  (id ${uni.id}, ${uni.slug}.${BASE})`);
const modules = uni.modules;

for (const arg of campusArgs) {
  const idx = arg.lastIndexOf(":");
  const name = arg.slice(0, idx).trim();
  const slug = arg.slice(idx + 1).trim();
  if (!name || !slug) { console.error(`skip "${arg}" — use "Name:slug"`); continue; }
  const clash = await getOne(`school?slug=eq.${encodeURIComponent(slug)}&select=id`);
  if (clash) { console.error(`  skip campus "${slug}" — a school with that slug already exists (id ${clash.id})`); continue; }
  const campus = await insert("school", { name, slug, code: slug.toUpperCase(), university_id: uni.id, modules });
  await insert("academic_year", { ...YEAR, is_current: true, school_id: campus.id });
  console.log(`  campus: ${campus.name}  (id ${campus.id}, ${campus.slug}.${BASE})`);
}

console.log("\nDone. Set a central admin by setting profile.university_id = " + uni.id + " on their account.");
