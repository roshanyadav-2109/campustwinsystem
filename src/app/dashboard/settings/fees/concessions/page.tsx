import { getConcessionTypes, getFeeHeads } from "@/lib/data/fees";
import { ConcessionTypesManager } from "@/components/fees/fees-plan";

export default async function ConcessionsPage() {
  const [types, heads] = await Promise.all([getConcessionTypes(), getFeeHeads()]);
  return <div className="max-w-3xl"><ConcessionTypesManager types={types} heads={heads} /></div>;
}
