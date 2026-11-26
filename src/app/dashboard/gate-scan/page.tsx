import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { GateScanner } from "@/components/attendance/gate-scanner";

// Scan students' ID cards at the gate: marks them present (or late).
export default async function GateScanPage() {
  const denied = await guardTab("/dashboard/gate-scan");
  if (denied) return denied;
  return (
    <div className="space-y-4">
      <PageHeader title="Gate scan" description="Scan a student's ID card QR with this phone's camera. They are marked present; a student already marked absent is marked late." />
      <GateScanner />
    </div>
  );
}
