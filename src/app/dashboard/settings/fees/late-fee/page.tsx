import { getLateRule } from "@/lib/data/fees";
import { LateFeeCard } from "@/components/fees/fees-plan";

export default async function LateFeePage() {
  return <div className="max-w-4xl"><LateFeeCard rule={await getLateRule()} /></div>;
}
