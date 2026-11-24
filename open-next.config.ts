import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal Cloudflare adapter config. Caching is left at defaults (in-worker);
// an R2/KV incremental cache can be added later if needed.
export default defineCloudflareConfig();
