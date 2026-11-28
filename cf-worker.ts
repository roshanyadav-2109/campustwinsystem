// Worker entry. The generated OpenNext worker loads the Next.js server inside the first request a fresh
// Worker copy receives; on the free plan (10 ms of CPU per request) that load alone uses up the limit.
// Importing the server here loads it while the Worker starts up, which has its own, larger allowance,
// so requests only pay for their own work. Everything else is the generated worker, unchanged.
// @ts-expect-error: created by the OpenNext build
import "./.open-next/server-functions/default/handler.mjs";

// Next.js also prepares itself once (manifests, routes) on the first request. Doing that here, at start-up,
// means a request cut off for CPU can never leave it half done for every later request on this copy.
// scripts/patch-worker.mjs exposes the server object after the build.
const nextServer = (globalThis as unknown as { __ctNextServer?: { prepare(): Promise<void> } }).__ctNextServer;
if (nextServer) {
  try { await nextServer.prepare(); } catch (e) { console.error("Next.js prepare at start-up failed; it will run on the first request", e); }
}

// @ts-expect-error: created by the OpenNext build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
// @ts-expect-error: created by the OpenNext build
export { default } from "./.open-next/worker.js";
