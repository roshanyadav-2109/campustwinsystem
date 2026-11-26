// Keeps the editions apart. Fails (exit 1) when:
//  - src/core imports an edition folder or the registry
//  - an edition folder imports another edition (university may build on college)
//  - an edition folder imports the registry (only the app composes editions)
// Run: node scripts/arch/check-boundaries.mjs   (runs before every deploy)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const EDITIONS = ["school", "college", "university"];
const MAY_USE = { school: [], college: [], university: ["college"] };

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield p;
  }
}
const importsOf = (code) => [...code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]);
// Resolve an import to a path under src/ (aliases "@/" and relative paths).
function target(file, spec) {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return relative(SRC, join(file, "..", spec)).split(sep).join("/");
  return null;
}

const problems = [];
const check = (dir, rule) => {
  let list;
  try { list = [...files(join(SRC, dir))]; } catch { return; }
  for (const f of list) {
    for (const spec of importsOf(readFileSync(f, "utf8"))) {
      const t = target(f, spec);
      if (!t) continue;
      const why = rule(t);
      if (why) problems.push(`${relative(ROOT, f)} imports "${spec}": ${why}`);
    }
  }
};

check("core", (t) => (t.startsWith("editions") ? "core must not depend on any edition" : null));
for (const e of EDITIONS) {
  check(join("editions", e), (t) => {
    if (t === "editions/registry" || t.startsWith("editions/registry")) return "editions must not import the registry";
    const m = t.match(/^editions\/([^/]+)/);
    if (m && m[1] !== e && !MAY_USE[e].includes(m[1])) return `the ${e} edition must not use the ${m[1]} edition`;
    return null;
  });
}

if (problems.length) {
  console.error(`Edition boundaries broken (${problems.length}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Edition boundaries OK");
