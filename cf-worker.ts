// Worker entry. The generated OpenNext worker loads the Next.js server inside the first request a fresh
// Worker copy receives; on the free plan (10 ms of CPU per request) that load alone uses up the limit.
// Importing the server here loads it while the Worker starts up, which has its own, larger allowance,
// so requests only pay for their own work. Everything else is the generated worker, unchanged.
// @ts-expect-error: created by the OpenNext build
import "./.open-next/server-functions/default/handler.mjs";

// Next.js also prepares itself once (manifests, routes) on the first request. Doing that here, at start-up,
// means a request cut off for CPU can never leave it half done for every later request on this copy.
// scripts/patch-worker.mjs exposes the server object after the build.
// Each page's code is likewise loaded the first time that page is asked for; a request cut off while loading it
// leaves that page broken on this copy. So every page is loaded here too.
const nextServer = (globalThis as unknown as { __ctNextServer?: { prepare(): Promise<void>; unstable_preloadEntries?: () => Promise<void> } }).__ctNextServer;
if (nextServer) {
  const t0 = Date.now();
  try { await nextServer.prepare(); } catch (e) { console.error("Next.js prepare at start-up failed; it will run on the first request", e); }
  try { await nextServer.unstable_preloadEntries?.(); } catch (e) { console.error("Loading pages at start-up failed; they load on first use", e); }
  console.log("start-up: Next.js ready in", Date.now() - t0, "ms");
}

// @ts-expect-error: created by the OpenNext build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
// @ts-expect-error: created by the OpenNext build
export { default } from "./.open-next/worker.js";
