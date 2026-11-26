import Link from "next/link";
import { getT } from "@/i18n/server";
import { getTodo } from "@/lib/data/todo";
import type { Session } from "@/lib/session";

// The first thing the office or principal sees: what needs doing today, each
// line a count and a link straight to the work.
export async function TodoPanel({ session }: { session: Session }) {
  const { t } = await getT();
  const items = await getTodo(session);
  return (
    <section aria-labelledby="todo-title" className="mb-6 rounded-md border border-hair bg-surface">
      <h2 id="todo-title" className="border-b border-hair px-4 py-3 text-[15px] font-semibold text-ink-900">{t("todo.title")}</h2>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-[14px] text-ink-700">{t("todo.none")}</p>
      ) : (
        <ul className="divide-y divide-hair">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#F5F9FE]">
                <span className="min-w-10 rounded-sm bg-[#EBF3FC] px-2 py-0.5 text-center text-[14px] font-semibold tabular text-[#0F6CBD]">{i.count.toLocaleString("en-IN")}</span>
                <span className="flex-1 text-[14px] text-ink-900">{t(`todo.${i.key}`)}</span>
                <span className="text-[13px] font-medium text-[#0F6CBD]">{t("todo.open")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
