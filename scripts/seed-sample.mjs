// Seeds a realistic set of SAMPLE institutions into the database the env points
// at: 3 schools, 2 colleges, and a university with 3 campuses — with classes or
// programmes, staff, students (with a profile photo in R2), guardians, 12 weeks
// of attendance, exams and marks, fees and payments, admissions, library,
// announcements, events and school transport.
//
// Sample institutions are identified by their fixed slug AND code (listed in
// scripts/clean-sample.mjs), which removes all of it, including R2.
//
//   node scripts/seed-sample.mjs --env .env.production.local --photo <jpg> --logo <png>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ENV_FILE = arg("--env", ".env.production.local");
const PHOTO = arg("--photo");
const LOGO = arg("--logo");
const env = Object.fromEntries(readFileSync(ENV_FILE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
const R2_ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET || "campustwin-media"}`;
const R2_PUBLIC = (env.R2_PUBLIC_BASE || "https://cdn.campustwin.org").replace(/\/+$/, "");

// ------------------------------------------------------------------ rng + data
let seed = 20261124;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const chance = (p) => rnd() < p;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const MALE = ["Aarav","Vihaan","Arjun","Reyansh","Aditya","Kabir","Ishaan","Rohan","Siddharth","Karthik","Aniket","Pranav","Rahul","Nikhil","Varun","Harsh","Yash","Dev","Omkar","Rajat","Sahil","Tanmay","Mihir","Akash","Gaurav","Abhinav","Naveen","Sameer","Faisal","Imran","Joel","Aaron","Gurpreet","Harjot","Manish","Vivek","Suraj","Anand","Kunal","Pratik","Atharv","Shaurya","Ayaan","Krish","Vedant"];
const FEMALE = ["Aanya","Diya","Ananya","Isha","Kavya","Meera","Saanvi","Riya","Priya","Neha","Pooja","Shreya","Aditi","Tanvi","Sneha","Ritika","Nandini","Pallavi","Divya","Anjali","Simran","Zoya","Ayesha","Fatima","Maria","Sara","Harleen","Jasleen","Lakshmi","Revathi","Keerthi","Swati","Bhavna","Megha","Trisha","Ira","Myra","Kiara","Avni","Gauri","Anika","Pari","Mahika","Navya","Siya"];
const SURNAMES = ["Sharma","Verma","Patel","Shah","Iyer","Nair","Menon","Reddy","Rao","Kulkarni","Deshpande","Joshi","Gupta","Agarwal","Mehta","Chopra","Malhotra","Kapoor","Singh","Gill","Sandhu","Bose","Banerjee","Mukherjee","Das","Pillai","Krishnan","Naidu","Patil","Pawar","Jain","Saxena","Mishra","Tiwari","Pandey","Chauhan","Rathore","Khan","Qureshi","Fernandes","Thomas","George","Varghese","Bhat","Hegde","Shetty","Dutta","Sinha"];
MALE.push("Arnav","Dhruv","Rudra","Parth","Lakshay","Ritvik","Advait","Neel","Om","Samarth","Hrithik","Jay","Kartik","Laksh","Madhav","Rishabh","Shivam","Tejas","Uday","Yuvraj","Zubin","Irfan","Aryan","Chirag","Darsh");
FEMALE.push("Aarohi","Bhumi","Charvi","Eshani","Hiya","Ishita","Jhanvi","Khushi","Mansi","Nitya","Ojasvi","Prisha","Rhea","Samaira","Tara","Urvi","Vaani","Yashvi","Zara","Inaya","Larissa","Mehak","Naina","Radhika","Sanya");
SURNAMES.push("Bhatt","Chatterjee","Ghosh","Kaur","Kumar","Lal","Mathur","Nagpal","Ojha","Prasad","Rastogi","Sethi","Trivedi","Upadhyay","Vyas","Wadhwa","Yadav","Ahuja","Bajaj","Chawla","Dhillon","Grewal","Kohli","Luthra","Mittal","Narang","Oberoi","Puri","Raina","Sabharwal");
const person = (g) => ({ first: g === "female" ? pick(FEMALE) : pick(MALE), last: pick(SURNAMES) });
// Distinct names inside one institution: nobody shares a full name with a classmate or colleague.
let usedNames = new Set();
const uniquePerson = (g) => {
  for (let k = 0; k < 500; k++) { const p = person(g); const key = `${p.first} ${p.last}`; if (!usedNames.has(key)) { usedNames.add(key); return p; } }
  throw new Error("Ran out of distinct names; widen the name pools");
};
const phone = () => `9${ri(100000000, 999999999)}`;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

const YEAR = { name: "2026-27", start_date: "2026-04-01", end_date: "2027-03-31" };
const MODULES = { twin: false, fees: true, library: true, homework: true, admissions: true, hr: true, transport: true };
const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

// School subjects by level, and the senior streams.
const schoolSubjects = (level, stream) => {
  if (level <= 5) return ["English", "Hindi", "Mathematics", "Environmental Studies"];
  if (level <= 10) return ["English", "Hindi", "Mathematics", "Science", "Social Science", "Computer Science"];
  return stream === "Commerce" ? ["English", "Accountancy", "Business Studies", "Economics", "Mathematics"] : ["English", "Physics", "Chemistry", "Mathematics", "Biology"];
};
const stageOf = (level) => (level <= 2 ? "foundational" : level <= 5 ? "preparatory" : level <= 8 ? "middle" : "senior");

const PROGRAM_SUBJECTS = {
  "B.Tech CSE": ["Programming in C", "Data Structures", "Discrete Mathematics", "Operating Systems", "Database Systems", "Computer Networks", "Algorithms"],
  "B.Tech ECE": ["Circuit Theory", "Digital Electronics", "Signals and Systems", "Electromagnetics", "Microprocessors", "Communication Systems"],
  "B.Tech ME": ["Engineering Mechanics", "Thermodynamics", "Fluid Mechanics", "Manufacturing Processes", "Machine Design", "Heat Transfer"],
  "B.Com": ["Financial Accounting", "Business Law", "Business Economics", "Cost Accounting", "Corporate Finance", "Income Tax"],
  "B.A.": ["Political Theory", "Indian History", "Sociology", "Microeconomics", "English Literature", "Public Administration"],
  "BBA": ["Principles of Management", "Business Statistics", "Marketing Management", "Organisational Behaviour", "Financial Management", "Business Analytics"],
  "MBA": ["Managerial Economics", "Strategic Management", "Operations Research", "Human Resource Management", "Corporate Finance", "Business Ethics"],
  "B.Sc Nursing": ["Anatomy", "Physiology", "Nutrition", "Community Health Nursing", "Pharmacology", "Medical Surgical Nursing"],
  "B.Pharm": ["Pharmaceutics", "Pharmaceutical Chemistry", "Human Anatomy", "Pharmacognosy", "Pharmacology", "Biopharmaceutics"],
};

const TENANTS = [
  { kind: "school", name: "Greenfield Public School", slug: "greenfield", code: "GFP", place: "Pune", color: "#1d6f42", upTo: 10, sections: ["A", "B"], per: [12, 15], transport: true },
  { kind: "school", name: "Riverside International School", slug: "riverside", code: "RIS", place: "Kochi", color: "#0e5a8a", upTo: 12, sections: ["A", "B"], per: [11, 14], streams: true, transport: true },
  { kind: "school", name: "St. Aldric Convent School", slug: "st-aldric", code: "SAC", place: "Shimla", color: "#7a2e3a", upTo: 8, sections: ["A", "B"], per: [12, 15], transport: true },
  { kind: "college", name: "Meridian Institute of Technology", slug: "meridian", code: "MIT", place: "Bengaluru", color: "#4b3f9a", programs: [["B.Tech CSE", 3, ["A", "B"]], ["B.Tech ECE", 3, ["A"]], ["B.Tech ME", 3, ["A"]]], per: [24, 30] },
  { kind: "college", name: "Lakeview College of Commerce and Arts", slug: "lakeview", code: "LCA", place: "Bhopal", color: "#2f6b5e", programs: [["B.Com", 3, ["A", "B"]], ["B.A.", 3, ["A"]], ["BBA", 3, ["A"]]], per: [22, 28] },
];
const UNIVERSITY = {
  name: "Westbridge University", slug: "westbridge", short: "Westbridge", color: "#1f3f73",
  campuses: [
    { kind: "college", name: "Westbridge North Campus", slug: "westbridge-north", code: "WBN", place: "Jaipur", programs: [["B.Tech CSE", 3, ["A", "B"]], ["B.Tech ECE", 2, ["A"]]], per: [22, 28] },
    { kind: "college", name: "Westbridge City Campus", slug: "westbridge-city", code: "WBC", place: "Jaipur", programs: [["BBA", 3, ["A"]], ["MBA", 2, ["A", "B"]]], per: [22, 28] },
    { kind: "college", name: "Westbridge Health Sciences Campus", slug: "westbridge-health", code: "WBH", place: "Udaipur", programs: [["B.Sc Nursing", 3, ["A"]], ["B.Pharm", 2, ["A"]]], per: [24, 30] },
  ],
};
export const SAMPLE_SLUGS = [...TENANTS.map((t) => t.slug), ...UNIVERSITY.campuses.map((c) => c.slug)];
export const SAMPLE_UNIVERSITIES = [UNIVERSITY.slug];

// ------------------------------------------------------------------ db helpers
async function ins(table, rows, select = "id") {
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const q = db.from(table).insert(rows.slice(i, i + 500));
    const { data, error } = select ? await q.select(select) : await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data) out.push(...data);
  }
  return out;
}
async function one(table, row, select = "id") { return (await ins(table, [row], select))[0]; }

async function putFile(key, buf, type) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await r2.fetch(`${R2_ENDPOINT}/${key}`, { method: "PUT", body: buf, headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000" } });
    if (r.ok) return `${R2_PUBLIC}/${key}`;
  }
  throw new Error(`R2 upload failed for ${key}`);
}
const putPhoto = (key, buf) => putFile(key, buf, "image/jpeg");
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// School days for the 12 weeks up to 23 Nov 2026, Monday to Saturday, minus holidays.
const HOLIDAYS = new Set(["2026-10-02", "2026-10-20", "2026-11-09", "2026-11-10"]);
const SCHOOL_DAYS = (() => { const out = []; for (let d = "2026-08-31"; d <= "2026-11-23"; d = addDays(d, 1)) { const wd = new Date(d + "T00:00:00Z").getUTCDay(); if (wd !== 0 && !HOLIDAYS.has(d)) out.push(d); } return out; })();

// ------------------------------------------------------------------ one tenant
async function seedTenant(t, uni, photo, logo) {
  const isCollege = t.kind === "college";
  const prefix = uni ? `universities/${uni.slug}/campuses/${t.slug}` : `schools/${t.slug}`;
  usedNames = new Set();
  process.stdout.write(`\n${t.name} (${t.slug})\n`);

  const logoUrl = logo ? await putFile(`${prefix}/brand/logo.png`, logo, "image/png") : null;
  const school = await one("school", {
    name: t.name, slug: t.slug, code: t.code, place: t.place, short_name: t.name, monogram: t.code.slice(0, 2),
    primary_color: t.color ?? UNIVERSITY.color, logo_url: logoUrl, modules: MODULES, tier: "shared", plan: isCollege ? "professional" : "standard",
    status: "active", university_id: uni?.id ?? null,
  });
  const S = school.id;
  const year = await one("academic_year", { ...YEAR, is_current: true, school_id: S });
  const Y = year.id;

  // Assessment types (names read naturally for colleges, codes stay the app's).
  const types = await ins("assessment_type", [
    { code: "periodic_test", name: isCollege ? "Internal Test" : "Periodic Test", is_numeric: true, school_id: S },
    { code: "half_yearly", name: isCollege ? "Mid-Semester Examination" : "Half-Yearly Examination", is_numeric: true, school_id: S },
    { code: "annual", name: isCollege ? "End-Semester Examination" : "Final Examination", is_numeric: true, school_id: S },
    { code: "observation", name: "Observation", is_numeric: false, school_id: S },
  ], "id, code");
  const typeId = Object.fromEntries(types.map((x) => [x.code, x.id]));

  // Classes (schools) or programme-years (colleges), each with its sections.
  const classSpecs = [];
  if (isCollege) {
    t.programs.forEach(([prog, years, secs], pi) => {
      for (let y = 1; y <= years; y++) {
        const pool = PROGRAM_SUBJECTS[prog];
        const subs = [0, 1, 2, 3, 4].map((k) => pool[(y - 1 + k) % pool.length]);
        classSpecs.push({ name: `${prog} Year ${y}`, level: (pi + 1) * 10 + y, stage: "senior", sections: secs, subjects: subs, age: 17 + y + (prog === "MBA" ? 4 : 0) });
      }
    });
  } else {
    for (let lv = 1; lv <= t.upTo; lv++) {
      if (t.streams && lv >= 11) {
        classSpecs.push({ name: ROMAN[lv - 1], level: lv, stage: "senior", sections: ["Science", "Commerce"], subjectsBySection: { Science: schoolSubjects(lv, "Science"), Commerce: schoolSubjects(lv, "Commerce") }, age: lv + 5 });
      } else {
        classSpecs.push({ name: ROMAN[lv - 1], level: lv, stage: stageOf(lv), sections: t.sections, subjects: schoolSubjects(lv), age: lv + 5 });
      }
    }
  }
  const classes = await ins("class", classSpecs.map((c) => ({ name: c.name, level: c.level, stage: c.stage, school_id: S })), "id, name");
  const classId = Object.fromEntries(classes.map((c) => [c.name, c.id]));

  const subjectNames = [...new Set(classSpecs.flatMap((c) => c.subjects ?? Object.values(c.subjectsBySection).flat()))];
  const subjects = await ins("subject", subjectNames.map((n, i) => ({ name: n, code: `${n.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase()}${i + 1}`, school_id: S })), "id, name");
  const subjectId = Object.fromEntries(subjects.map((s) => [s.name, s.id]));
  const cs = [];
  for (const c of classSpecs) for (const n of new Set(c.subjects ?? Object.values(c.subjectsBySection).flat())) cs.push({ class_id: classId[c.name], subject_id: subjectId[n], school_id: S });
  await ins("class_subject", cs, null);

  const sectionRows = [];
  for (const c of classSpecs) for (const sec of c.sections) sectionRows.push({ name: sec, class_id: classId[c.name], school_id: S });
  const sections = await ins("section", sectionRows, "id, name, class_id");
  const specOfClass = Object.fromEntries(classSpecs.map((c) => [classId[c.name], c]));
  const secInfo = sections.map((s) => { const c = specOfClass[s.class_id]; return { ...s, spec: c, label: `${c.name}-${s.name}`, subjects: c.subjects ?? c.subjectsBySection[s.name] }; });

  // Staff: head, office, one teacher per subject, a class/faculty advisor per section, transport crew.
  const domain = `${t.slug}.example`;
  const staffRows = [];
  const mk = (role, title) => { const g = chance(0.5) ? "female" : "male"; const p = uniquePerson(g); const honor = title ?? (isCollege ? (chance(0.6) ? "Dr." : g === "female" ? "Ms." : "Mr.") : g === "female" ? (chance(0.5) ? "Mrs." : "Ms.") : "Mr."); staffRows.push({ full_name: `${honor} ${p.first} ${p.last}`, role, employee_code: `${t.code}-E${String(staffRows.length + 1).padStart(3, "0")}`, email: `${p.first}.${p.last}${staffRows.length}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + `@${domain}`, phone: phone(), school_id: S }); return staffRows.length - 1; };
  const head = mk("principal", "Dr.");
  mk("office"); mk("office");
  const subjTeacher = {};
  for (const n of subjectNames) subjTeacher[n] = mk("subject_teacher");
  const advisor = {};
  for (const s of secInfo) advisor[s.id] = mk("class_teacher");
  const crew = t.transport ? [mk("transport", "Mr."), mk("transport", "Mr."), mk("transport", "Mr."), mk("transport", "Mr.")] : [];
  const staff = await ins("staff", staffRows, "id");
  const sid = (i) => staff[i].id;

  const allot = [];
  for (const s of secInfo) {
    allot.push({ staff_id: sid(advisor[s.id]), section_id: s.id, subject_id: subjectId[s.subjects[0]], is_class_teacher: true, academic_year_id: Y, school_id: S });
    for (const n of s.subjects.slice(1)) allot.push({ staff_id: sid(subjTeacher[n]), section_id: s.id, subject_id: subjectId[n], is_class_teacher: false, academic_year_id: Y, school_id: S });
  }
  await ins("teacher_allotment", allot, null);

  // Students, guardians, enrolment.
  const stuSpecs = [];
  for (const s of secInfo) {
    const n = ri(t.per[0], t.per[1]);
    for (let k = 0; k < n; k++) {
      const g = chance(0.5) ? "female" : "male";
      const p = uniquePerson(g);
      const dob = `${2026 - s.spec.age}-${String(ri(1, 12)).padStart(2, "0")}-${String(ri(1, 28)).padStart(2, "0")}`;
      stuSpecs.push({ sec: s, g, p, dob, ability: clamp(0.55 + (rnd() - 0.5) * 0.6 + (chance(0.12) ? 0.2 : 0), 0.25, 0.98), att: clamp(0.9 + (rnd() - 0.55) * 0.22, 0.6, 1) });
    }
  }
  const students = await ins("student", stuSpecs.map((x, i) => ({
    admission_no: `${t.code}26${String(i + 1).padStart(4, "0")}`, full_name: `${x.p.first} ${x.p.last}`, dob: x.dob, gender: x.g,
    phone: isCollege ? phone() : null, email: isCollege ? `${x.p.first}.${x.p.last}${i}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + `@students.${domain}` : null,
    status: "active", school_id: S,
  })), "id");
  stuSpecs.forEach((x, i) => { x.id = students[i].id; });
  // Roll numbers in name order inside each section.
  const bySec = {};
  for (const x of stuSpecs) (bySec[x.sec.id] ??= []).push(x);
  for (const list of Object.values(bySec)) list.sort((a, b) => `${a.p.first} ${a.p.last}`.localeCompare(`${b.p.first} ${b.p.last}`)).forEach((x, i) => { x.roll = i + 1; });
  await ins("student_enrollment", stuSpecs.map((x) => ({ student_id: x.id, section_id: x.sec.id, academic_year_id: Y, roll_no: x.roll, status: "active", school_id: S })), null);

  const guardians = await ins("guardian", stuSpecs.map((x, i) => { const rel = chance(0.52) ? "Mother" : "Father"; const gp = person(rel === "Mother" ? "female" : "male"); return { full_name: `${gp.first} ${x.p.last}`, relation: rel, phone: phone(), email: chance(0.35) ? `${gp.first}.${x.p.last}${i}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@mail.example" : null, school_id: S }; }), "id");
  await ins("guardian_student", stuSpecs.map((x, i) => ({ guardian_id: guardians[i].id, student_id: x.id, is_primary: true, school_id: S })), null);

  // Profile photo for every student, stored at the student's own R2 key.
  process.stdout.write(`  photos for ${stuSpecs.length} students … `);
  await pool(stuSpecs, 16, async (x) => { x.photo = await putPhoto(`${prefix}/students/${x.id}/photo.jpg`, photo); });
  await pool(stuSpecs, 16, async (x) => { const { error } = await db.from("student").update({ photo_path: x.photo }).eq("id", x.id); if (error) throw new Error(`photo_path: ${error.message}`); });
  console.log("done");

  // Attendance: each student has their own regularity.
  process.stdout.write(`  attendance for ${SCHOOL_DAYS.length} days … `);
  const att = [];
  for (const x of stuSpecs) for (const d of SCHOOL_DAYS) {
    const r = rnd();
    const status = r < x.att ? (chance(0.05) ? "late" : "present") : chance(0.15) ? "leave" : "absent";
    att.push({ student_id: x.id, section_id: x.sec.id, academic_year_id: Y, on_date: d, status, period: null, marked_by: sid(advisor[x.sec.id]), school_id: S });
  }
  await ins("attendance_record", att, null);
  console.log(`${att.length.toLocaleString()} records`);

  // Exams: three rounds per section and subject, with marks for every student.
  const ROUNDS = [
    { name: isCollege ? "Internal Test 1" : "Periodic Test 1", type: "periodic_test", date: "2026-07-15", max: 40, term: 1, pub: 1 },
    { name: isCollege ? "Mid-Semester Examination" : "Half-Yearly Examination", type: "half_yearly", date: "2026-09-22", max: 80, term: 1, pub: 1 },
    { name: isCollege ? "Internal Test 2" : "Periodic Test 2", type: "periodic_test", date: "2026-11-16", max: 40, term: 2, pub: 0.6 },
  ];
  const aSpecs = [];
  for (const s of secInfo) for (const n of s.subjects) for (const r of ROUNDS) aSpecs.push({ s, n, r, published: chance(r.pub) });
  const assessments = await ins("assessment", aSpecs.map((a) => ({
    name: a.r.name, section_id: a.s.id, subject_id: subjectId[a.n], academic_year_id: Y, assessment_type_id: typeId[a.r.type], max_marks: a.r.max,
    assessed_on: a.r.date, term: a.r.term, is_published: a.published, published_at: a.published ? `${addDays(a.r.date, 10)}T10:00:00Z` : null,
    created_by: a.s.subjects[0] === a.n ? sid(advisor[a.s.id]) : sid(subjTeacher[a.n]), school_id: S,
  })), "id");
  const marks = [];
  aSpecs.forEach((a, i) => {
    for (const x of bySec[a.s.id] ?? []) {
      if (chance(0.03)) { marks.push({ assessment_id: assessments[i].id, student_id: x.id, marks_obtained: null, is_absent: true, school_id: S }); continue; }
      const p = clamp(x.ability + (rnd() - 0.5) * 0.24, 0.12, 1);
      marks.push({ assessment_id: assessments[i].id, student_id: x.id, marks_obtained: Math.round(p * a.r.max * 2) / 2, is_absent: false, entered_by: null, school_id: S });
    }
  });
  await ins("mark", marks, null);
  console.log(`  exams: ${assessments.length} assessments, ${marks.length.toLocaleString()} marks`);

  // Fees: heads, structure, two terms invoiced, most paid.
  const headNames = isCollege ? ["Tuition", "Laboratory", "Examination"] : t.transport ? ["Tuition", "Development", "Transport"] : ["Tuition", "Development", "Activities"];
  const heads = await ins("fee_head", headNames.map((n) => ({ name: n, is_active: true, school_id: S })), "id, name");
  const annual = (c, h) => isCollege ? ({ Tuition: 96000, Laboratory: 12000, Examination: 6000 })[h] : ({ Tuition: 18000 + c.level * 2400, Development: 6000, Transport: 14000, Activities: 4000 })[h];
  await ins("fee_structure", classSpecs.flatMap((c) => heads.map((h) => ({ academic_year_id: Y, class_id: classId[c.name], fee_head_id: h.id, amount: annual(c, h.name), school_id: S }))), null);
  const invSpecs = [];
  for (const x of stuSpecs) for (const [term, due, paidP, partP] of [["Term 1 fees", "2026-05-15", 0.94, 0.03], ["Term 2 fees", "2026-10-15", 0.7, 0.1]]) {
    const lines = heads.filter((h) => h.name !== "Transport" || chance(0.35)).map((h) => ({ head: h.id, amount: annual(x.sec.spec, h.name) / 2 }));
    const amount = lines.reduce((t2, l) => t2 + l.amount, 0);
    const r = rnd();
    const paid = r < paidP ? amount : r < paidP + partP ? Math.round(amount * 0.5) : 0;
    invSpecs.push({ x, term, due, lines, amount, paid });
  }
  const invoices = await ins("fee_invoice", invSpecs.map((v) => ({ student_id: v.x.id, section_id: v.x.sec.id, academic_year_id: Y, title: v.term, amount: v.amount, paid_amount: v.paid, due_date: v.due, status: v.paid >= v.amount ? "paid" : v.paid > 0 ? "part" : "due", school_id: S })), "id");
  await ins("fee_invoice_line", invSpecs.flatMap((v, i) => v.lines.map((l) => ({ invoice_id: invoices[i].id, fee_head_id: l.head, amount: l.amount, school_id: S }))), null);
  await ins("fee_payment", invSpecs.flatMap((v, i) => v.paid > 0 ? [{ invoice_id: invoices[i].id, student_id: v.x.id, amount: v.paid, paid_on: addDays(v.due, -ri(0, 20)), mode: pick(["upi", "upi", "bank", "card", "cash", "cheque"]), reference: `TXN${ri(10000000, 99999999)}`, received_by: sid(1), is_refund: false, school_id: S }] : []), null);
  console.log(`  fees: ${invoices.length} invoices`);

  // Admissions pipeline for next session.
  const STAT = ["new", "new", "contacted", "contacted", "visit_scheduled", "applied", "admitted", "not_interested"];
  await ins("admission_enquiry", Array.from({ length: ri(14, 22) }, () => {
    const g = chance(0.5) ? "female" : "male"; const p = person(g); const status = pick(STAT); const c = pick(classSpecs);
    return { child_name: `${p.first} ${p.last}`, date_of_birth: `${2026 - c.age}-${String(ri(1, 12)).padStart(2, "0")}-${String(ri(1, 28)).padStart(2, "0")}`, class_id: classId[c.name], guardian_name: `${person(chance(0.5) ? "female" : "male").first} ${p.last}`, phone: phone(), email: chance(0.6) ? `${p.last.toLowerCase()}${ri(10, 99)}@mail.example` : null, source: pick(["walk_in", "phone", "online", "online", "referral"]), status, next_follow_up: ["new", "contacted", "visit_scheduled", "applied"].includes(status) ? addDays("2026-11-24", ri(1, 14)) : null, academic_year_id: Y, school_id: S, created_at: `${addDays("2026-11-23", -ri(0, 60))}T09:00:00Z` };
  }), null);

  // Library with a few loans out and some overdue.
  const BOOKS = [["Wings of Fire","A. P. J. Abdul Kalam","Biography"],["The Discovery of India","Jawaharlal Nehru","History"],["Malgudi Days","R. K. Narayan","Fiction"],["Godan","Munshi Premchand","Fiction"],["Train to Pakistan","Khushwant Singh","Fiction"],["The Guide","R. K. Narayan","Fiction"],["Gitanjali","Rabindranath Tagore","Poetry"],["A Brief History of Time","Stephen Hawking","Science"],["Concepts of Physics Vol 1","H. C. Verma","Science"],["Mathematics for Class X","R. D. Sharma","Reference"],["Oxford Advanced Learner's Dictionary","Oxford University Press","Reference"],["The Story of My Experiments with Truth","M. K. Gandhi","Biography"],["Ignited Minds","A. P. J. Abdul Kalam","Non-fiction"],["Panchatantra","Vishnu Sharma","Children"],["The Jungle Book","Rudyard Kipling","Children"],["Sapiens","Yuval Noah Harari","Non-fiction"],["Introduction to Algorithms","Cormen et al.","Reference"],["Principles of Economics","N. Gregory Mankiw","Reference"],["The Alchemist","Paulo Coelho","Fiction"],["Atomic Habits","James Clear","Non-fiction"]];
  const books = await ins("library_book", BOOKS.map(([title, author, category], i) => ({ accession_no: `${t.code}-B-${String(i + 1).padStart(4, "0")}`, title, author, category, language: "English", shelf: `${String.fromCharCode(65 + (i % 6))}-${ri(1, 9)}`, copies_total: ri(2, 6), is_active: true, school_id: S })), "id");
  await ins("library_issue", Array.from({ length: ri(18, 30) }, () => {
    const issued = addDays("2026-11-23", -ri(2, 40)); const due = addDays(issued, 14); const returned = chance(0.55) ? addDays(issued, ri(3, 14)) : null; const overdue = !returned && due < "2026-11-24";
    return { book_id: pick(books).id, student_id: pick(stuSpecs).id, issued_on: issued, due_on: due, returned_on: returned, fine_amount: overdue ? 2 * ri(2, 20) : 0, fine_paid: false, issued_by: sid(1), school_id: S };
  }), null);

  // Announcements and calendar.
  const ANN = isCollege
    ? [["Mid-semester results are out", "Results for the mid-semester examinations are now available in the portal."], ["Placement drive on 4 December", "Final-year students should register with the placement cell by 30 November."], ["Library hours extended", "The central library stays open until 9 pm during the examination weeks."], ["Guest lecture on data privacy", "All students are invited to the seminar hall on Friday at 11 am."], ["Fee deadline reminder", "Second-term fees are due. Please clear dues to avoid a late fee."]]
    : [["Annual Sports Day on 12 December", "Parents are welcome. Events start at 8 am on the main ground."], ["Half-yearly report cards", "Report cards can now be viewed in the parent portal."], ["Winter uniform from 1 December", "Students should switch to the winter uniform from Monday, 1 December."], ["Parent-teacher meeting on Saturday", "Meet your child's class teacher between 9 am and 1 pm."], ["Science exhibition entries open", "Students of all classes can submit projects by 5 December."]];
  await ins("announcement", ANN.map(([title, body], i) => ({ title, body, scope: "school", published_at: `${addDays("2026-11-23", -i * 9)}T08:30:00Z`, created_by: sid(head), academic_year_id: Y, school_id: S })), null);
  await ins("event", [
    { title: isCollege ? "End-semester examinations begin" : "Periodic Test 2 week", event_type: "exam", start_date: "2026-12-07", end_date: "2026-12-12", academic_year_id: Y, school_id: S, remind_before_days: 3 },
    { title: "Winter break", event_type: "holiday", start_date: "2026-12-24", end_date: "2027-01-01", academic_year_id: Y, school_id: S, remind_before_days: 2 },
    { title: isCollege ? "Industry connect day" : "Parent-teacher meeting", event_type: isCollege ? "activity" : "ptm", start_date: "2026-11-28", end_date: "2026-11-28", academic_year_id: Y, school_id: S, remind_before_days: 2 },
  ], null);

  // School transport: two routes and buses, about a third of students riding.
  if (t.transport) {
    const ROUTES = { Pune: [["Kothrud to Shivajinagar", 18.507, 73.807], ["Hadapsar to Camp", 18.508, 73.926]], Kochi: [["Edappally to Kaloor", 10.025, 76.308], ["Vyttila to Fort Kochi", 9.966, 76.318]], Shimla: [["Sanjauli to Mall Road", 31.105, 77.18], ["Totu to Chotta Shimla", 31.098, 77.135]] }[t.place];
    const routes = await ins("route", ROUTES.map(([name], i) => ({ code: `R${i + 1}`, name, is_active: true, school_id: S })), "id");
    const stops = [];
    ROUTES.forEach(([, lat, lng], i) => { for (let k = 0; k < 5; k++) stops.push({ route_id: routes[i].id, seq: k + 1, name: `Stop ${k + 1}`, lat: lat + k * 0.006, lng: lng + k * 0.004, cum_distance_m: k * 1800, geofence_m: 120, sched_am: `07:${String(5 + k * 7).padStart(2, "0")}`, sched_pm: `14:${String(10 + k * 7).padStart(2, "0")}`, school_id: S }); });
    const stopRows = await ins("route_stop", stops, "id, route_id");
    const buses = await ins("bus", routes.map((_, i) => ({ code: `BUS-0${i + 1}`, registration_no: `${({ Pune: "MH 12", Kochi: "KL 07", Shimla: "HP 03" })[t.place]} ${String.fromCharCode(65 + i)}B ${ri(1000, 9999)}`, capacity: 40, is_active: true, school_id: S })), "id");
    await ins("bus_assignment", routes.map((r, i) => ({ bus_id: buses[i].id, route_id: r.id, driver_staff_id: sid(crew[i * 2]), conductor_staff_id: sid(crew[i * 2 + 1]), is_active: true, academic_year_id: Y, school_id: S })), null);
    const riders = stuSpecs.filter(() => chance(0.33));
    await ins("student_transport", riders.map((x) => { const r = pick(routes); const rs = stopRows.filter((s) => s.route_id === r.id); const st = pick(rs); return { student_id: x.id, route_id: r.id, pickup_stop_id: st.id, drop_stop_id: st.id, is_active: true, academic_year_id: Y, school_id: S }; }), null);
    console.log(`  transport: ${riders.length} riders`);
  }
  console.log(`  students ${stuSpecs.length}, staff ${staffRows.length}, sections ${secInfo.length}`);
  return stuSpecs.length;
}

// ------------------------------------------------------------------ run
if (process.argv[1] && process.argv[1].endsWith("seed-sample.mjs")) {
  if (!PHOTO) throw new Error("Pass --photo <jpg> (square profile photo)");
  const photo = readFileSync(PHOTO);
  const logo = LOGO ? readFileSync(LOGO) : null;
  const uniOnly = process.argv.includes("--university-only");
  const { data: clash } = await db.from("school").select("slug").in("slug", uniOnly ? UNIVERSITY.campuses.map((c) => c.slug) : SAMPLE_SLUGS);
  const { data: uclash } = uniOnly ? { data: [] } : await db.from("university").select("slug").in("slug", SAMPLE_UNIVERSITIES);
  if ((clash ?? []).length || (uclash ?? []).length) throw new Error(`Sample data already present (${[...(clash ?? []), ...(uclash ?? [])].map((x) => x.slug).join(", ")}). Run scripts/clean-sample.mjs first.`);

  let total = 0;
  if (!uniOnly) for (const t of TENANTS) total += await seedTenant(t, null, photo, logo);
  const uniLogo = logo ? await putFile(`universities/${UNIVERSITY.slug}/brand/logo.png`, logo, "image/png") : null;
  const { data: existingUni } = await db.from("university").select("id, slug").eq("slug", UNIVERSITY.slug).maybeSingle();
  const uni = existingUni ?? await one("university", { name: UNIVERSITY.name, slug: UNIVERSITY.slug, short_name: UNIVERSITY.short, primary_color: UNIVERSITY.color, logo_url: uniLogo, modules: MODULES, plan: "enterprise", status: "active" }, "id, slug");
  for (const c of UNIVERSITY.campuses) total += await seedTenant(c, uni, photo, logo);
  console.log(`\nSeeded ${TENANTS.length + UNIVERSITY.campuses.length} institutions, ${total.toLocaleString()} students.`);
}
