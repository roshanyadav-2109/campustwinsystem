// Timetable generator: places every class's lessons for the week.
//
// Hard rules: one lesson per section per period; a teacher is never in two lessons at once (a combined
// lesson across sections is one lesson); a named room or lab holds one lesson at a time; teachers'
// unavailable periods, blocked periods and shorter days are respected; a teacher's daily limit (counting
// lessons in classes not being made); a subject's daily limit; double periods sit in two periods next to
// each other without a break between.
// Wishes (scored): a subject spread over the week, not twice in a row, the class teacher in the first
// period, a teacher's day not too heavy, daily subjects earlier in the day.
// Pure TypeScript with no imports: it runs in a browser worker (and in tests).

export type SolverLoad = { sectionId: number; subjectId: number; staffId: number | null; periods: number; double: boolean; maxPerDay: number | null; room?: string | null };
export type SolverGroup = { id: number; sectionIds: number[]; items: { subjectId: number; staffId: number | null }[]; periods: number; double: boolean; maxPerDay: number | null; room?: string | null };
export type SolverFixed = { sectionId: number; day: number; period: number; subjectId: number | null; staffIds: number[]; room?: string | null; groupId?: number | null };
export type SolverInput = {
  days: number[];
  periods: number[];                       // teaching periods, in the order of the day
  doubleStarts: number[];                  // periods where a double can start (the next follows without a break)
  dayPeriods?: Record<number, number>;     // a shorter day: only the first n teaching periods
  blocked?: { day: number; period: number }[];   // no lessons (assembly, clubs)
  sections: { id: number; classTeacherId: number | null }[];
  loads: SolverLoad[];
  groups?: SolverGroup[];
  fixed: SolverFixed[];                    // lessons kept in the classes being made
  busy: { staffId: number; day: number; period: number }[];        // teachers' unavailable periods
  elsewhere?: { staffId: number | null; day: number; period: number; room?: string | null }[];   // lessons in classes not being made
  teacherMaxDay: number;
  maxConsecutive?: number;               // a teacher teaches at most this many periods in a row
  classTeacherFirst: boolean;
  timeMs?: number;
  seed?: number;
};
export type SolverCell = { sectionId: number; day: number; period: number; subjectId: number; staffId: number | null; groupId: number | null; room: string | null;
  extras: { subjectId: number; staffId: number | null }[] };
export type SolverResult = {
  cells: SolverCell[];
  unplaced: { sectionId: number; subjectId: number; groupId: number | null; count: number; reason: string }[];
  attempts: number; placed: number; wanted: number;
};

type Unit = { key: string; sectionIds: number[]; subjectId: number; staffIds: number[]; items: { subjectId: number; staffId: number | null }[];
  groupId: number | null; room: string | null; len: 1 | 2; maxPerDay: number; weekly: number };

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
  const blocked = new Set((inp.blocked ?? []).map((b) => `${b.day}|${b.period}`));
  const open = (d: number, p: number) => !blocked.has(`${d}|${p}`) && (inp.dayPeriods?.[d] == null || (pIndex.get(p) ?? 99) < inp.dayPeriods[d]);
  const k = (a: number | string, d: number, p: number) => `${a}|${d}|${p}`;
  const roomKey = (r: string | null | undefined) => (r ? r.trim().toLowerCase() : null);
  const slotsPerWeek = days.reduce((a, d) => a + periods.filter((p) => open(d, p)).length, 0);

  // lessons still to place: the weekly load less what is kept
  const keptCount = new Map<string, number>();
  for (const f of inp.fixed) {
    const key = f.groupId ? `g${f.groupId}|${f.sectionId}` : `${f.sectionId}|${f.subjectId}`;
    keptCount.set(key, (keptCount.get(key) ?? 0) + 1);
  }
  const units: Unit[] = [];
  let wanted = 0;
  const pushUnits = (base: Omit<Unit, "len" | "maxPerDay" | "weekly">, weekly: number, kept: number, double: boolean, maxPerDay: number | null) => {
    const rem = Math.max(0, weekly - kept);
    wanted += rem * base.sectionIds.length;
    const mpd = maxPerDay ?? Math.max(double ? 2 : 1, Math.ceil(weekly / days.length));
    const pairs = double && mpd >= 2 ? Math.floor(rem / 2) : 0;
    for (let i = 0; i < pairs; i++) units.push({ ...base, len: 2, maxPerDay: mpd, weekly });
    for (let i = 0; i < rem - 2 * pairs; i++) units.push({ ...base, len: 1, maxPerDay: mpd, weekly });
  };
  for (const l of inp.loads) {
    pushUnits({ key: `s${l.subjectId}`, sectionIds: [l.sectionId], subjectId: l.subjectId, staffIds: l.staffId != null ? [l.staffId] : [], items: [{ subjectId: l.subjectId, staffId: l.staffId }],
      groupId: null, room: l.room ?? null }, l.periods, keptCount.get(`${l.sectionId}|${l.subjectId}`) ?? 0, l.double, l.maxPerDay);
  }
  for (const g of inp.groups ?? []) {
    if (!g.items.length || !g.sectionIds.length) continue;
    const kept = Math.min(...g.sectionIds.map((s) => keptCount.get(`g${g.id}|${s}`) ?? 0));
    pushUnits({ key: `g${g.id}`, sectionIds: g.sectionIds, subjectId: g.items[0].subjectId, staffIds: [...new Set(g.items.map((i) => i.staffId).filter((x): x is number => x != null))],
      items: g.items, groupId: g.id, room: g.room ?? null }, g.periods, kept, g.double, g.maxPerDay);
  }
  const teacherLoad = new Map<number, number>();
  for (const u of units) for (const t of u.staffIds) teacherLoad.set(t, (teacherLoad.get(t) ?? 0) + u.len);

  const budget = inp.timeMs ?? 2500;
  const started = Date.now(), deadline = started + budget;
  const rand0 = rng(inp.seed ?? Math.floor(Math.random() * 1e9));
  let best: { placed: Map<Unit, { d: number; p: number }>; left: Unit[]; score: number } | null = null;
  let attempts = 0;

  while (attempts === 0 || (Date.now() < deadline && attempts < 500)) {
    attempts++;
    const rand = rng(Math.floor(rand0() * 1e9));
    const secCell = new Map<string, { u: Unit | null; fixed: boolean }>();
    const staffAt = new Set<string>();
    const teachAt = new Set<string>();     // periods a teacher actually teaches (not merely unavailable)
    const roomAt = new Set<string>();
    const staffDay = new Map<string, number>();
    const subjDay = new Map<string, number>();
    for (const b of inp.busy) staffAt.add(k(b.staffId, b.day, b.period));
    for (const e of inp.elsewhere ?? []) {
      if (e.staffId != null) teachAt.add(k(e.staffId, e.day, e.period));
      if (e.staffId != null && !staffAt.has(k(e.staffId, e.day, e.period))) { staffAt.add(k(e.staffId, e.day, e.period)); staffDay.set(`${e.staffId}|${e.day}`, (staffDay.get(`${e.staffId}|${e.day}`) ?? 0) + 1); }
      const r = roomKey(e.room); if (r) roomAt.add(k(r, e.day, e.period));
    }
    const subjKey = (sec: number, u: Unit | { key: string }, d: number) => `${sec}|${u.key}|${d}`;
    for (const f of inp.fixed) {
      secCell.set(k(f.sectionId, f.day, f.period), { u: null, fixed: true });
      for (const t of f.staffIds) teachAt.add(k(t, f.day, f.period));
      for (const t of f.staffIds) if (!staffAt.has(k(t, f.day, f.period))) { staffAt.add(k(t, f.day, f.period)); staffDay.set(`${t}|${f.day}`, (staffDay.get(`${t}|${f.day}`) ?? 0) + 1); }
      const r = roomKey(f.room); if (r) roomAt.add(k(r, f.day, f.period));
      const key = f.groupId ? `g${f.groupId}` : `s${f.subjectId}`;
      subjDay.set(subjKey(f.sectionId, { key }, f.day), (subjDay.get(subjKey(f.sectionId, { key }, f.day)) ?? 0) + 1);
    }
    const where = new Map<Unit, { d: number; p: number }>();
    const span = (u: Unit, p: number) => (u.len === 2 ? [p, nextOf(p)] : [p]);

    let relax = 0;   // a last pass may allow a subject once more in a day
    const fits = (u: Unit, d: number, p: number) => {
      const ps = span(u, p);
      if (u.len === 2 && (!doubleOk.has(p) || ps[1] == null)) return false;
      const r = roomKey(u.room);
      for (const q of ps) {
        if (!open(d, q)) return false;
        for (const s of u.sectionIds) if (secCell.has(k(s, d, q))) return false;
        for (const t of u.staffIds) if (staffAt.has(k(t, d, q))) return false;
        if (r && roomAt.has(k(r, d, q))) return false;
      }
      for (const t of u.staffIds) if ((staffDay.get(`${t}|${d}`) ?? 0) + u.len > inp.teacherMaxDay) return false;
      // not more periods in a row than the limit
      if (inp.maxConsecutive) for (const t of u.staffIds) {
        const i0 = pIndex.get(ps[0])!, i1 = pIndex.get(ps[ps.length - 1])!;
        let run = ps.length;
        for (let i = i0 - 1; i >= 0 && periods[i] === periods[i + 1] - 1 && teachAt.has(k(t, d, periods[i])); i--) run++;
        for (let i = i1 + 1; i < periods.length && periods[i] === periods[i - 1] + 1 && teachAt.has(k(t, d, periods[i])); i++) run++;
        if (run > Math.max(inp.maxConsecutive, 2)) return false;
      }
      for (const s of u.sectionIds) if ((subjDay.get(subjKey(s, u, d)) ?? 0) + u.len > u.maxPerDay + relax) return false;
      return true;
    };
    const cost = (u: Unit, d: number, p: number, noise: boolean) => {
      let c = noise ? rand() * 0.9 : 0;
      for (const s of u.sectionIds) {
        c += (subjDay.get(subjKey(s, u, d)) ?? 0) * 6;                       // spread over the week
        const i = pIndex.get(p)!;
        for (const q of [periods[i - 1], periods[i + u.len]]) {               // not twice in a row
          const n = q == null ? undefined : secCell.get(k(s, d, q));
          if (n?.u && n.u.key === u.key && n.u !== u) c += 3;
        }
        const cTeacher = ct.get(s);
        if (inp.classTeacherFirst && p === first && cTeacher != null) c += u.staffIds.includes(cTeacher) ? -4 : 3;
      }
      for (const t of u.staffIds) c += (staffDay.get(`${t}|${d}`) ?? 0) * 0.6;   // even days for teachers
      if (u.weekly >= days.length && (pIndex.get(p) ?? 0) >= periods.length - 2) c += 0.8;
      return c;
    };
    const mark = (u: Unit, d: number, q: number, on: boolean) => {
      const r = roomKey(u.room);
      for (const s of u.sectionIds) { if (on) secCell.set(k(s, d, q), { u, fixed: false }); else secCell.delete(k(s, d, q)); }
      for (const t of u.staffIds) { if (on) teachAt.add(k(t, d, q)); else teachAt.delete(k(t, d, q)); }
      for (const t of u.staffIds) { if (on) staffAt.add(k(t, d, q)); else staffAt.delete(k(t, d, q)); staffDay.set(`${t}|${d}`, (staffDay.get(`${t}|${d}`) ?? 0) + (on ? 1 : -1)); }
      if (r) { if (on) roomAt.add(k(r, d, q)); else roomAt.delete(k(r, d, q)); }
      for (const s of u.sectionIds) subjDay.set(subjKey(s, u, d), (subjDay.get(subjKey(s, u, d)) ?? 0) + (on ? 1 : -1));
    };
    const place = (u: Unit, d: number, p: number) => { for (const q of span(u, p)) mark(u, d, q, true); where.set(u, { d, p }); };
    const unplace = (u: Unit) => { const w = where.get(u)!; for (const q of span(u, w.p)) mark(u, w.d, q, false); where.delete(u); };
    const bestCell = (u: Unit) => {
      let b: { d: number; p: number; c: number } | null = null;
      for (const d of days) for (const p of periods) { if (!fits(u, d, p)) continue; const c = cost(u, d, p, true); if (!b || c < b.c) b = { d, p, c }; }
      return b;
    };

    // the hardest first: doubles, groups across sections, the busiest teachers
    const order = units.map((u) => ({ u, key: (u.len === 2 ? 1000 : 0) + u.sectionIds.length * 200 + u.staffIds.reduce((a, t) => a + (teacherLoad.get(t) ?? 0), 0) + rand() * 6 }))
      .sort((a, b) => b.key - a.key).map((x) => x.u);
    const left: Unit[] = [];
    for (const u of order) {
      const b = bestCell(u);
      if (b) { place(u, b.d, b.p); continue; }
      // repair: move one lesson that blocks this one (same section, or the same teacher) elsewhere
      let done = false;
      outer: for (const d of days) for (const p of periods) {
        if (!open(d, p)) continue;
        const blockers = new Set<Unit>();
        for (const q of span(u, p)) {
          for (const s of u.sectionIds) { const o = secCell.get(k(s, d, q)); if (o?.fixed) continue outer; if (o?.u) blockers.add(o.u); }
          for (const [o, w] of where) if (w.d === d && span(o, w.p).includes(q) && o.staffIds.some((t) => u.staffIds.includes(t))) blockers.add(o);
        }
        if (blockers.size !== 1) continue;
        const other = [...blockers][0];
        const was = where.get(other)!;
        unplace(other);
        if (fits(u, d, p)) {
          place(u, d, p);
          const alt = bestCell(other);
          if (alt) { place(other, alt.d, alt.p); done = true; break outer; }
          unplace(u);
        }
        place(other, was.d, was.p);
      }
      if (!done) left.push(u);
    }
    // last pass: what is left may take a subject's second period of a day (better than not at all)
    if (left.length) {
      relax = 1;
      for (let i = left.length - 1; i >= 0; i--) { const b = bestCell(left[i]); if (b) { place(left[i], b.d, b.p); left.splice(i, 1); } }
      relax = 0;
    }
    let score = left.reduce((a, u) => a + u.len * u.sectionIds.length, 0) * 1000;
    for (const [u, w] of where) score += cost(u, w.d, w.p, false);
    if (!best || score < best.score) best = { placed: new Map(where), left, score };
    // stop early only when everything fits and some of the time has been used to improve the wishes
    if (best.left.length === 0 && Date.now() - started > budget * 0.35) break;
  }

  const cells: SolverCell[] = [];
  for (const [u, w] of best!.placed) for (const q of (u.len === 2 ? [w.p, nextOf(w.p)] : [w.p])) for (const s of u.sectionIds) {
    cells.push({ sectionId: s, day: w.d, period: q, subjectId: u.items[0].subjectId, staffId: u.items[0].staffId, groupId: u.groupId, room: u.room, extras: u.items.slice(1) });
  }

  // what could not be placed, and why
  const tNeed = new Map<number, number>();
  for (const u of units) for (const t of u.staffIds) tNeed.set(t, (tNeed.get(t) ?? 0) + u.len);
  const tBusy = new Map<number, number>();
  for (const b of inp.busy) tBusy.set(b.staffId, (tBusy.get(b.staffId) ?? 0) + 1);
  for (const e of inp.elsewhere ?? []) if (e.staffId != null) tBusy.set(e.staffId, (tBusy.get(e.staffId) ?? 0) + 1);
  const secNeed = new Map<number, number>();
  for (const u of units) for (const s of u.sectionIds) secNeed.set(s, (secNeed.get(s) ?? 0) + u.len);
  const keptBy = new Map<number, number>();
  for (const f of inp.fixed) keptBy.set(f.sectionId, (keptBy.get(f.sectionId) ?? 0) + 1);
  const groups = new Map<string, { sectionId: number; subjectId: number; groupId: number | null; count: number; u: Unit }>();
  for (const u of best!.left) for (const s of u.sectionIds) {
    const key = `${s}|${u.key}`;
    const g = groups.get(key) ?? { sectionId: s, subjectId: u.subjectId, groupId: u.groupId, count: 0, u };
    g.count += u.len; groups.set(key, g);
  }
  const unplaced = [...groups.values()].map((g) => {
    let reason = "No period fits all the rules; try fewer periods, a higher daily limit, another teacher or room.";
    const free = slotsPerWeek - (keptBy.get(g.sectionId) ?? 0);
    const busyT = g.u.staffIds.find((t) => (tNeed.get(t) ?? 0) + (tBusy.get(t) ?? 0) > days.length * Math.min(periods.length, inp.teacherMaxDay));
    if ((secNeed.get(g.sectionId) ?? 0) > free) reason = `The class needs ${secNeed.get(g.sectionId)} periods a week but has ${free} free.`;
    else if (busyT != null) reason = "A teacher has more periods than the week (and the daily limit) allows.";
    else if (g.u.len === 2) reason = "No two free periods in a row for the double period.";
    else if (g.u.room) reason = `The room "${g.u.room}" is full at every period that suits.`;
    return { sectionId: g.sectionId, subjectId: g.subjectId, groupId: g.groupId, count: g.count, reason };
  });
  const placedCount = cells.length;
  return { cells, unplaced, attempts, placed: placedCount, wanted };
}
