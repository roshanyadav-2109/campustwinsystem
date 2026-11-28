"use client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadPdf } from "@/lib/pdf";

export type UniChart = { university: string; central: { title: string; holder: string; acting: boolean }[];
  campuses: { campus: string; positions: { title: string; holder: string; acting: boolean }[]; deans: number; heads: number }[] };
const who = (p: { title: string; holder: string; acting: boolean }) => `${p.title}: ${p.holder}${p.acting ? " (acting)" : ""}`;

// The university from the top: the central positions, then each campus with its heads.
export function UniversityChart({ chart }: { chart: UniChart | null }) {
  if (!chart) return null;
  const print = () => void downloadPdf({ filename: `${chart.university} chart`, title: "Organisation chart", meta: [chart.university], school: chart.university,
    blocks: [{ kind: "text", heading: "University", lines: chart.central.length ? chart.central.map(who) : ["No university-wide positions yet"] },
      ...chart.campuses.map((c) => ({ kind: "text" as const, heading: c.campus, lines: [...c.positions.map(who), `${c.deans} dean${c.deans === 1 ? "" : "s"}, ${c.heads} heads of department`] }))] });
  return (
    <Card>
      <CardHeader title="The university's chart" action={<Button size="sm" variant="subtle" onClick={print}>Print</Button>} />
      <CardBody className="space-y-3 text-[13px]">
        <div><div className="font-semibold text-ink-900">University</div>{chart.central.length ? <ul>{chart.central.map((p, i) => <li key={i}>{who(p)}</li>)}</ul> : <p className="text-ink-500">No university-wide positions yet (Settings, Positions).</p>}</div>
        <div className="grid gap-3 sm:grid-cols-2">{chart.campuses.map((c) => (
          <div key={c.campus} className="rounded-sm border border-hair p-3"><div className="font-semibold text-ink-900">{c.campus}</div>
            {c.positions.length ? <ul>{c.positions.map((p, i) => <li key={i}>{who(p)}</li>)}</ul> : <p className="text-ink-500">No heads recorded.</p>}
            <p className="text-ink-500">{c.deans} dean{c.deans === 1 ? "" : "s"}, {c.heads} heads of department</p></div>))}</div>
      </CardBody>
    </Card>
  );
}
