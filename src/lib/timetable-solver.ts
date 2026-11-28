// Timetable generator: places every class's lessons for the week.
//
// Hard rules: one lesson per section per period; a teacher is never in two places; a teacher's
// unavailable periods and lessons in classes not being generated are respected; a teacher's daily
// limit; a subject's daily limit; double periods sit in two periods next to each other.
// Wishes (scored): a subject spread over the week, not twice in a row, the class teacher in the
// first period, a teacher's day not too heavy. Several attempts with different orders are made in a
// time budget and the best kept; anything that cannot be placed is reported with a reason.
// Pure TypeScript with no imports, so it runs in the browser (and in tests).

export type SolverInput = {
  days: number[];
  periods: number[];                  // teaching periods, in the order of the day
  doubleStarts: number[];             // periods where a double can start (the next one follows without a break)
  sections: { id: number; classTeacherId: number | null }[];
  loads: { sectionId: number; subjectId: number; staffId: number | null; periods: number; double: boolean; maxPerDay: number | null }[];
  fixed: { sectionId: number; day: number; period: number; subjectId: number | null; staffId: number | null }[];
  busy: { staffId: number; day: number; period: number }[];
  teacherMaxDay: number;
  classTeacherFirst: boolean;
  timeMs?: number;
  seed?: number;
};
export type SolverCell = { sectionId: number; day: number; period: number; subjectId: number; staffId: number | null };
export type SolverResult = {
  cells: SolverCell[];
  unplaced: { sectionId: number; subjectId: number; count: number; reason: string }[];
  attempts: number;
  placed: number;
  wanted: number;
};

type Unit = { sectionId: number; subjectId: number; staffId: number | null; len: 1 | 2; maxPerDay: number; weekly: number };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function solveTimetable(inp: SolverInput): SolverResult {
  const days = inp.days, periods = inp.periods;
  const pIndex = new Map(periods.map((p, i) => [p, i]));
  const first = periods[0];
  const doubleOk = new Set(inp.doubleStarts);
  const nextOf = (p: number) => periods[(pIndex.get(p) ?? -2) + 1];
  const ct = new Map(inp.sections.map((s) => [s.id, s.classTeacherId]));
  const k = (a: number, d: number, p: number) => `${a}|${d}|${p}`;

  // lessons still to place: the weekly load less what is kept
  const keptCount = new Map<string, number>();
  for (const f of inp.fixed) if (f.subjectId != null) keptCount.set(`${f.sectionId}|${f.subjectId}`, (keptCount.get(`${f.sectionId}|${f.subjectId}`) ?? 0) + 1);
  const units: Unit[] = [];
  let wanted = 0;
  for (const l of inp.loads) {
    const rem = Math.max(0, l.periods - (keptCount.get(`${l.sectionId}|${l.subjectId}`) ?? 0));
    wanted += rem;
    const maxPerDay = l.maxPerDay ?? Math.max(l.double ? 2 : 1, Math.ceil(l.periods / days.length));
    const pairs = l.double && maxPerDay >= 2 ? Math.floor(rem / 2) : 0;
    for (let i = 0; i < pairs; i++) units.push({ sectionId: l.sectionId, subjectId: l.subjectId, staffId: l.staffId, len: 2, maxPerDay, weekly: l.periods });
    for (let i = 0; i < rem - 2 * pairs; i++) units.push({ sectionId: l.sectionId, subjectId: l.subjectId, staffId: l.staffId, len: 1, maxPerDay, weekly: l.periods });
  }
  // how loaded each teacher is (the busiest are placed first)
  const teacherLoad = new Map<number, number>();
  for (const u of units) if (u.staffId != null) teacherLoad.set(u.staffId, (teacherLoad.get(u.staffId) ?? 0) + u.len);

  const deadline = Date.now() + (inp.timeMs ?? 2500);
  const rand0 = rng(inp.seed ?? 7);
  let best: { cells: SolverCell[]; left: Unit[]; score: number } | null = null;
  let attempts = 0;

  while (attempts === 0 || (Date.now() < deadline && attempts < 400)) {
    attempts++;
    const rand = rng(Math.floor(rand0() * 1e9));
    // state
    const secCell = new Map<string, { u: Unit | null; fixed: boolean }>();
    const staffAt = new Set<string>();
    const staffDay = new Map<string, number>();
    const subjDay = new Map<string, number>();
    for (const b of inp.busy) staffAt.add(k(b.staffId, b.day, b.period));
    const put = (u: Unit | null, sectionId: number, subjectId: number | null, staffId: number | null, d: number, p: number, fixed: boolean) => {
      secCell.set(k(sectionId, d, p), { u, fixed });
      if (staffId != null) { staffAt.add(k(staffId, d, p)); staffDay.set(`${staffId}|${d}`, (staffDay.get(`${staffId}|${d}`) ?? 0) + 1); }
      if (subjectId != null) subjDay.set(`${sectionId}|${subjectId}|${d}`, (subjDay.get(`${sectionId}|${subjectId}|${d}`) ?? 0) + 1);
    };
    const take = (u: Unit, d: number, p: number) => {
      secCell.delete(k(u.sectionId, d, p));
      if (u.staffId != null) { staffAt.delete(k(u.staffId, d, p)); staffDay.set(`${u.staffId}|${d}`, (staffDay.get(`${u.staffId}|${d}`) ?? 1) - 1); }
      subjDay.set(`${u.sectionId}|${u.subjectId}|${d}`, (subjDay.get(`${u.sectionId}|${u.subjectId}|${d}`) ?? 1) - 1);
    };
    for (const f of inp.fixed) put(null, f.sectionId, f.subjectId, f.staffId, f.day, f.period, true);
    const where = new Map<Unit, { d: number; p: number }>();

    const fits = (u: Unit, d: number, p: number) => {
      const ps = u.len === 2 ? [p, nextOf(p)] : [p];
      if (u.len === 2 && (!doubleOk.has(p) || ps[1] == null)) return false;
      for (const q of ps) {
        if (secCell.has(k(u.sectionId, d, q))) return false;
        if (u.staffId != null && staffAt.has(k(u.staffId, d, q))) return false;
      }
      if (u.staffId != null && (staffDay.get(`${u.staffId}|${d}`) ?? 0) + u.len > inp.teacherMaxDay) return false;
      if ((subjDay.get(`${u.sectionId}|${u.subjectId}|${d}`) ?? 0) + u.len > u.maxPerDay) return false;
      return true;
    };
    const cost = (u: Unit, d: number, p: number) => {
      let c = rand() * 0.9;
      const same = subjDay.get(`${u.sectionId}|${u.subjectId}|${d}`) ?? 0;
      c += same * 6;                                                     // spread over the week
      const i = pIndex.get(p)!;
      for (const q of [periods[i - 1], periods[i + u.len]]) {            // not twice in a row
        const n = q == null ? undefined : secCell.get(k(u.sectionId, d, q));
        if (n?.u && n.u.subjectId === u.subjectId) c += 3;
      }
      const cTeacher = ct.get(u.sectionId);
      if (inp.classTeacherFirst && p === first && cTeacher != null) c += u.staffId === cTeacher ? -4 : 3;
      if (u.staffId != null) c += (staffDay.get(`${u.staffId}|${d}`) ?? 0) * 0.6;   // even days for teachers
      if (u.weekly >= days.length && i >= periods.length - 2) c += 0.8;  // daily subjects earlier in the day
      return c;
    };
    const place = (u: Unit, d: number, p: number) => {
      put(u, u.sectionId, u.subjectId, u.staffId, d, p, false);
      if (u.len === 2) put(u, u.sectionId, u.subjectId, u.staffId, d, nextOf(p), false);
      where.set(u, { d, p });
    };
    const unplace = (u: Unit) => {
      const w = where.get(u)!; take(u, w.d, w.p); if (u.len === 2) take(u, w.d, nextOf(w.p)); where.delete(u);
    };

    const order = units.map((u) => ({ u, key: (u.len === 2 ? 1000 : 0) + (u.staffId != null ? teacherLoad.get(u.staffId) ?? 0 : 0) + rand() * 6 }))
      .sort((a, b) => b.key - a.key).map((x) => x.u);
    const left: Unit[] = [];
    for (const u of order) {
      let bestCell: { d: number; p: number; c: number } | null = null;
      for (const d of days) for (const p of periods) {
        if (!fits(u, d, p)) continue;
        const c = cost(u, d, p);
        if (!bestCell || c < bestCell.c) bestCell = { d, p, c };
      }
      if (bestCell) { place(u, bestCell.d, bestCell.p); continue; }
      // repair: move one single lesson of this section out of the way
      let done = false;
      for (const d of days) {
        for (const p of periods) {
          const occ = secCell.get(k(u.sectionId, d, p));
          if (!occ?.u || occ.fixed || occ.u.len !== 1 || u.len !== 1) continue;
          const other = occ.u;
          unplace(other);
          if (fits(u, d, p)) {
            let alt: { d: number; p: number; c: number } | null = null;
            place(u, d, p);
            for (const d2 of days) for (const p2 of periods) { if (fits(other, d2, p2)) { const c = cost(other, d2, p2); if (!alt || c < alt.c) alt = { d: d2, p: p2, c }; } }
            if (alt) { place(other, alt.d, alt.p); done = true; break; }
            unplace(u);
          }
          const w = { d, p }; place(other, w.d, w.p);
        }
        if (done) break;
      }
      if (!done) left.push(u);
    }
    // score: what is left counts most, then the wishes
    let score = left.reduce((a, u) => a + u.len, 0) * 1000;
    for (const [u, w] of where) score += cost(u, w.d, w.p) - 0.45;
    if (!best || score < best.score) {
      const cells: SolverCell[] = [];
      for (const [u, w] of where) {
        cells.push({ sectionId: u.sectionId, day: w.d, period: w.p, subjectId: u.subjectId, staffId: u.staffId });
        if (u.len === 2) cells.push({ sectionId: u.sectionId, day: w.d, period: nextOf(w.p), subjectId: u.subjectId, staffId: u.staffId });
      }
      best = { cells, left, score };
    }
    if (best.left.length === 0 && attempts >= 3) break;
  }

  // what could not be placed, and why
  const free = (sectionId: number) => days.length * periods.length - inp.fixed.filter((f) => f.sectionId === sectionId).length;
  const need = new Map<number, number>();
  for (const l of inp.loads) need.set(l.sectionId, (need.get(l.sectionId) ?? 0) + Math.max(0, l.periods - (keptCount.get(`${l.sectionId}|${l.subjectId}`) ?? 0)));
  const tNeed = new Map<number, number>();
  for (const l of inp.loads) if (l.staffId != null) tNeed.set(l.staffId, (tNeed.get(l.staffId) ?? 0) + l.periods);
  const tBusy = new Map<number, number>();
  for (const b of inp.busy) tBusy.set(b.staffId, (tBusy.get(b.staffId) ?? 0) + 1);
  const groups = new Map<string, { sectionId: number; subjectId: number; count: number; staffId: number | null; len: number }>();
  for (const u of best!.left) {
    const g = groups.get(`${u.sectionId}|${u.subjectId}`) ?? { sectionId: u.sectionId, subjectId: u.subjectId, count: 0, staffId: u.staffId, len: u.len };
    g.count += u.len; groups.set(`${u.sectionId}|${u.subjectId}`, g);
  }
  const unplaced = [...groups.values()].map((g) => {
    let reason = "No period fits all the rules; try fewer periods, a higher daily limit, or another teacher.";
    if ((need.get(g.sectionId) ?? 0) > free(g.sectionId)) reason = `The class needs ${need.get(g.sectionId)} periods a week but has ${free(g.sectionId)} free.`;
    else if (g.staffId != null && (tNeed.get(g.staffId) ?? 0) + (tBusy.get(g.staffId) ?? 0) > days.length * Math.min(periods.length, inp.teacherMaxDay)) reason = "The teacher has more periods than the week (and the daily limit) allows.";
    else if (g.len === 2) reason = "No two free periods in a row for the double period.";
    return { sectionId: g.sectionId, subjectId: g.subjectId, count: g.count, reason };
  });
  return { cells: best!.cells, unplaced, attempts, placed: wanted - unplaced.reduce((a, x) => a + x.count, 0), wanted };
}
