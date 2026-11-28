// After `opennextjs-cloudflare build`: make the Next.js server object reachable, so cf-worker.ts can run its
// one-time prepare() while the Worker starts up. Otherwise prepare() runs inside the first request a fresh
// Worker copy gets; if that request runs out of CPU (free plan, 10 ms), the half-done promise is left behind
// and every later request on that copy waits on it and fails until the next deploy.
import { readFileSync, writeFileSync } from "node:fs";
const file = ".open-next/server-functions/default/handler.mjs";
const s = readFileSync(file, "utf8");
const at = "var routesLoaded=!1;globalThis.__next_route_preloader=";
if (s.includes("globalThis.__ctNextServer=nextServer;")) { console.log("patch-worker: already patched"); process.exit(0); }
if (!s.includes(at)) { console.error("patch-worker: marker not found; OpenNext output changed. Check scripts/patch-worker.mjs."); process.exit(1); }
writeFileSync(file, s.replace(at, "globalThis.__ctNextServer=nextServer;" + at));
console.log("patch-worker: Next.js server exposed for start-up prepare");
