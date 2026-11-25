// One-time move of the live CampusTwin data from the old project (TSNM,
// gvfudrhdowlwvpbtctsl) into the new live project (uiakimzaixtfcklqlwqz).
// The old project is only READ, through its service key; nothing there changes,
// so it stays as the backup.
//
//   SUPABASE_ACCESS_TOKEN=<token for the new project> node scripts/swap-db.mjs <phase>
// phases, in order: wipe, users, copy, sequences, verify
//
// Source credentials come from .env.production.local (the old live), target from
// .env.local (the new project). Both are checked against the expected project
// refs before anything runs.
import { readFileSync, appendFileSync } from "node:fs";

const OLD = "gvfudrhdowlwvpbtctsl";
const NEW = "uiakimzaixtfcklqlwqz";
const rd = (f) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const S = rd(process.env.SOURCE_ENV || ".env.production.local");
const T = rd(process.env.TARGET_ENV || ".env.local");
if (!S.NEXT_PUBLIC_SUPABASE_URL.includes(OLD)) throw new Error("source env is not the old live project");
if (!T.NEXT_PUBLIC_SUPABASE_URL.includes(NEW)) throw new Error("target env is not the new project");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN (new project) is required");
const LOG = process.env.SWAP_LOG || "swap-db.log";
const log = (...a) => { const line = a.join(" "); console.log(line); appendFileSync(LOG, new Date().toISOString() + " " + line + "\n"); };

const SH = { apikey: S.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + S.SUPABASE_SERVICE_ROLE_KEY };
const TH = { apikey: T.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + T.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" };

async function sql(query, attempt = 1) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${NEW}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) {
    if (attempt < 4 && (r.status >= 500 || r.status === 429)) { await new Promise((ok) => setTimeout(ok, 2000 * attempt)); return sql(query, attempt + 1); }
    throw new Error(`SQL ${r.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function sourceGet(path, attempt = 1) {
  const r = await fetch(`${S.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers: SH });
  if (!r.ok) {
    if (attempt < 4) { await new Promise((ok) => setTimeout(ok, 2000 * attempt)); return sourceGet(path, attempt + 1); }
    throw new Error(`source ${r.status} ${path}: ${(await r.text()).slice(0, 300)}`);
  }
  return r.json();
}

async function sourceCount(table) {
  const r = await fetch(`${S.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: { ...SH, Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") || "/0").split("/")[1]);
}

async function tables() {
  const rows = await sql(`
    select t.table_name as t,
      (select json_agg(a.attname order by array_position(i.indkey, a.attnum))
         from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = ('public.' || quote_ident(t.table_name))::regclass and i.indisprimary) as pk,
      (select json_agg(c.column_name order by c.ordinal_position) from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name and c.is_generated = 'NEVER') as cols
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by t.table_name`);
  return rows.map((r) => ({ name: r.t, pk: r.pk ?? [], cols: r.cols ?? [] }));
}

const phase = process.argv[2];

if (phase === "wipe") {
  // Logins of the new project (test accounts) go; their profiles are truncated below.
  let users = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(`${T.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: TH })).json();
    users = users.concat(r.users ?? []);
    if (!r.users || r.users.length < 1000) break;
  }
  const list = await tables();
  await sql(`set session_replication_role = replica;
    truncate ${list.map((t) => `public.${t.name}`).join(", ")} restart identity cascade;
    truncate core.organisation cascade;
    truncate hr.team;`);
  log("wipe: truncated", list.length, "public tables, core organisations and HR");
  for (const u of users) {
    const d = await fetch(`${T.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: TH });
    log("wipe: removed login", u.email, d.status);
  }
} else if (phase === "users") {
  const src = await (await fetch(`${S.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: SH })).json();
  for (const u of src.users) {
    const body = { id: u.id, email: u.email, email_confirm: true, user_metadata: u.user_metadata ?? {} };
    if (u.email?.endsWith("@kv.demo")) body.password = "kviit@demo1";
    const r = await fetch(`${T.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: TH, body: JSON.stringify(body) });
    const j = await r.json();
    log("users:", u.email, r.status, j.id === u.id ? "same id" : `ID MISMATCH ${j.id ?? ""} ${j.msg ?? j.message ?? ""}`);
  }
} else if (phase === "copy") {
  const only = process.argv[3]?.split(",");
  const list = (await tables()).filter((t) => !only || only.includes(t.name));
  const TAG = "$eternity_rows$";
  const spec = await sourceGet("");
  for (const t of list) {
    const expected = await sourceCount(t.name);
    const sourceCols = Object.keys(spec.definitions?.[t.name]?.properties ?? {});
    const cols = t.cols.filter((c) => sourceCols.includes(c));
    if (!cols.length || expected === 0) { log(`copy: ${t.name} 0 rows`); continue; }
    const single = t.pk.length === 1 ? t.pk[0] : null;
    const order = (t.pk.length ? t.pk : cols).map((c) => `${c}.asc`).join(",");
    const sel = cols.map((c) => `"${c}"`).join(",");
    let copied = 0, last = null, offset = 0, batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const json = JSON.stringify(batch);
      if (json.includes(TAG)) throw new Error(`data in ${t.name} contains the quoting tag`);
      await sql(`set session_replication_role = replica;
        insert into public.${t.name} (${sel}) overriding system value
        select ${sel} from json_populate_recordset(null::public.${t.name}, ${TAG}${json}${TAG}::json);`);
      copied += batch.length;
      batch = [];
    };
    for (;;) {
      let q = `${t.name}?select=${cols.join(",")}&order=${order}&limit=1000`;
      if (single && last !== null) q += `&${single}=gt.${encodeURIComponent(last)}`;
      else if (!single) q += `&offset=${offset}`;
      const rows = await sourceGet(q);
      if (!rows.length) break;
      batch.push(...rows);
      if (single) last = rows[rows.length - 1][single];
      offset += rows.length;
      if (batch.length >= 3000) await flush();
      if (rows.length < 1000) break;
    }
    await flush();
    log(`copy: ${t.name} ${copied}/${expected}${copied === expected ? "" : "  <-- COUNT DIFFERS"}`);
  }
} else if (phase === "sequences") {
  const rows = await sql(`
    select c.table_name t, c.column_name col
    from information_schema.columns c
    where c.table_schema = 'public' and (c.is_identity = 'YES' or c.column_default like 'nextval(%')`);
  for (const r of rows) {
    await sql(`select setval(pg_get_serial_sequence('public.${r.t}', '${r.col}'),
      coalesce((select max(${r.col}) from public.${r.t}), 1),
      (select max(${r.col}) from public.${r.t}) is not null);`);
  }
  log("sequences: reset", rows.length, "counters");
} else if (phase === "verify") {
  const list = await tables();
  let bad = 0;
  for (const t of list) {
    const a = await sourceCount(t.name);
    const [{ n }] = await sql(`select count(*)::int n from public.${t.name}`);
    if (a !== n) { bad++; log(`verify: ${t.name} old=${a} new=${n}  <-- DIFFERENT`); }
  }
  log(bad ? `verify: ${bad} TABLES DIFFER` : `verify: all ${list.length} tables match`);
} else {
  console.log("phase: wipe | users | copy [tables] | sequences | verify");
}
