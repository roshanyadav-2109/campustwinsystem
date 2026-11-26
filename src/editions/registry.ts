// The composition root: the only place that sees every edition. Menus, page
// guards and screens ask the registry, never an edition folder directly.
import type { Edition } from "@/core/edition";
import type { RouteDef } from "@/core/routes";
import type { EditionWords } from "@/core/words";
import { SHARED_ROUTES } from "@/core/shared-routes";
import * as school from "@/editions/school";
import * as college from "@/editions/college";
import * as university from "@/editions/university";

const EDITION_MODULES: Record<Edition, { routes: RouteDef[]; words: EditionWords }> = { school, college, university };

/** Every page: shared ones plus each edition's own, tagged with that edition. */
export const ROUTES: RouteDef[] = [
  ...SHARED_ROUTES,
  ...(Object.entries(EDITION_MODULES) as [Edition, { routes: RouteDef[] }][])
    .flatMap(([e, m]) => m.routes.map((r) => ({ ...r, editions: r.editions ?? [e] }))),
];

export const wordsFor = (e: Edition): EditionWords => EDITION_MODULES[e].words;
