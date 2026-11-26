"use client";
/* eslint-disable @next/next/no-img-element -- photos and logos come from the school's own storage */
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export type FamilyCard = {
  name: string; admission_no: string; dob: string | null; gender: string | null; photo: string | null; status: string;
  class: string | null; roll_no: number | null;
  school: { name: string; place: string | null; logo: string | null; phone: string | null };
  id_card: { token: string; year: string; issued: string } | null;
  profile: { blood_group: string | null; house: string | null; address: string | null; emergency_name: string | null; emergency_phone: string | null; admission_date: string | null; allergies: string | null } | null;
  identity: { apaar_id: string | null; pen: string | null; aadhaar_last4: string | null } | null;
  guardians: { name: string; relation: string | null; phone: string | null; email: string | null }[];
};

function Qr({ data, size = 112 }: { data: string; size?: number }) {
  const path = useMemo(() => {
    const q = qrcode(0, "M"); q.addData(data); q.make();
    const n = q.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [data]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} role="img" aria-label="QR code to check this card" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={path.n + 4} height={path.n + 4} fill="#fff" /><path d={path.d} fill="#111827" />
    </svg>
  );
}

const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-");

export function DigitalIdCard({ c, verifyBase }: { c: FamilyCard; verifyBase: string }) {
  if (!c.id_card) {
    return (
      <div className="rounded-md border border-dashed border-hair bg-white p-5 text-[13px] text-ink-700">
        No ID card has been issued for {c.name} yet. It appears here as soon as the school prints it.
      </div>
    );
  }
  const url = verifyBase + c.id_card.token;
  return (
    <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-hair bg-white shadow-sm" aria-label={`ID card of ${c.name}`}>
      <div className="flex items-center gap-2 bg-[#0F6CBD] px-4 py-2.5 text-white">
        {c.school.logo && <img src={c.school.logo} alt="" className="h-8 w-8 rounded-sm bg-white object-contain p-0.5" />}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight">{c.school.name}</p>
          {c.school.place && <p className="truncate text-[11px] opacity-90">{c.school.place}</p>}
        </div>
        <span className="ml-auto text-[11px] font-medium opacity-90">Student ID · {c.id_card.year}</span>
      </div>
      <div className="flex gap-3 p-4">
        <div className="h-28 w-[88px] shrink-0 overflow-hidden rounded-md border border-hair bg-panel">
          {c.photo ? <img src={c.photo} alt={`Photo of ${c.name}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px] text-ink-500">No photo</div>}
        </div>
        <dl className="min-w-0 flex-1 space-y-0.5 text-[12px]">
          <dd className="truncate text-[15px] font-semibold text-ink-900">{c.name}</dd>
          <div className="flex gap-1"><dt className="text-ink-500">Class</dt><dd className="text-ink-900">{c.class ?? "-"}{c.roll_no != null ? `, roll ${c.roll_no}` : ""}</dd></div>
          <div className="flex gap-1"><dt className="text-ink-500">Adm. no.</dt><dd className="text-ink-900">{c.admission_no}</dd></div>
          {c.profile?.blood_group && <div className="flex gap-1"><dt className="text-ink-500">Blood group</dt><dd className="text-ink-900">{c.profile.blood_group}</dd></div>}
          {c.dob && <div className="flex gap-1"><dt className="text-ink-500">Born</dt><dd className="text-ink-900">{dmy(c.dob)}</dd></div>}
          {c.school.phone && <div className="flex gap-1"><dt className="text-ink-500">School</dt><dd className="text-ink-900">{c.school.phone}</dd></div>}
        </dl>
        <div className="shrink-0 self-end"><Qr data={url} size={92} /></div>
      </div>
      <p className="border-t border-hair px-4 py-1.5 text-[10px] text-ink-500">Scan the code to check this card. Shown on the phone, it is valid like the printed card.</p>
    </div>
  );
}

export function FamilyDetails({ c }: { c: FamilyCard }) {
  const rows: [string, string][] = [
    ["Admission no.", c.admission_no], ["Class", c.class ?? "-"], ["Date of birth", dmy(c.dob)], ["Gender", c.gender ?? "-"],
    ["Admitted on", dmy(c.profile?.admission_date ?? null)], ["Blood group", c.profile?.blood_group ?? "-"], ["House", c.profile?.house ?? "-"],
    ["Address", c.profile?.address || "-"], ["Emergency contact", [c.profile?.emergency_name, c.profile?.emergency_phone].filter(Boolean).join(", ") || "-"],
    ["Allergies", c.profile?.allergies ?? "-"], ["APAAR id", c.identity?.apaar_id ?? "-"], ["PEN", c.identity?.pen ?? "-"],
    ["Aadhaar", c.identity?.aadhaar_last4 ? `ending ${c.identity.aadhaar_last4}` : "-"],
  ];
  return (
    <div className="rounded-md border border-hair bg-white">
      <dl className="divide-y divide-hair text-[13px]">
        {rows.map(([k, v]) => <div key={k} className="flex gap-4 px-4 py-2"><dt className="w-40 shrink-0 text-ink-500">{k}</dt><dd className="text-ink-900">{v}</dd></div>)}
        <div className="flex gap-4 px-4 py-2"><dt className="w-40 shrink-0 text-ink-500">Parents</dt>
          <dd className="space-y-0.5 text-ink-900">{c.guardians.map((g) => <p key={g.name}>{g.name}{g.relation ? ` (${g.relation})` : ""}{g.phone ? `, ${g.phone}` : ""}{g.email ? `, ${g.email}` : ""}</p>)}</dd></div>
      </dl>
      <p className="border-t border-hair px-4 py-2 text-[12px] text-ink-500">Something wrong? Ask the school office to correct it.</p>
    </div>
  );
}
