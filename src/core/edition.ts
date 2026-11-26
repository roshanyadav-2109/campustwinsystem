// Which kind of institution a tenant is. Everything that differs between a
// school, a college and a university hangs off this one value; see
// docs/campustwin/architecture.md and the edition folders under src/editions.
//
// core/ never imports an edition folder: it only knows the edition's name.

export type Edition = "school" | "college" | "university";

export const EDITIONS: Edition[] = ["school", "college", "university"];

/** The edition of an institution row: a campus of a university is a university
 *  institution whatever its own type says; otherwise the type set in the
 *  console decides. */
export function editionOf(inst: { institution_type?: string | null; university_id?: number | null }): Edition {
  if (inst.university_id) return "university";
  return inst.institution_type === "college" ? "college" : "school";
}

/** Colleges and universities share the higher-education rules (fee letters,
 *  loans, credits, semesters). */
export const isHigherEd = (e: Edition) => e !== "school";
