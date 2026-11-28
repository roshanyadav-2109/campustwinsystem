// Worker entry. The generated OpenNext worker loads the Next.js server inside the first request a fresh
// Worker copy receives; on the free plan (10 ms of CPU per request) that load alone uses up the limit.
// Importing the server here loads it while the Worker starts up, which has its own, larger allowance,
// so requests only pay for their own work. Everything else is the generated worker, unchanged.
// @ts-expect-error: created by the OpenNext build
import "./.open-next/server-functions/default/handler.mjs";
// @ts-expect-error: created by the OpenNext build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
// @ts-expect-error: created by the OpenNext build
export { default } from "./.open-next/worker.js";
