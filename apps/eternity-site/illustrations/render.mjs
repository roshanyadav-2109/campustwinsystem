// Renders each illustration's #art element to a 2x PNG for conversion to WebP.
// Run from apps/desk (which has playwright-core installed):
//   node ../eternity-site/illustrations/render.mjs campustwin [hr ...]
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// playwright-core is installed in the working directory's node_modules (apps/desk).
const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright-core");
const here = dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const p = await b.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
for (const n of names) {
  await p.goto(pathToFileURL(join(here, n + ".html")).href, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.locator("#art").screenshot({ path: join("D:/tmp", `ill-${n}.png`) });
  console.log("rendered", n);
}
await b.close();
