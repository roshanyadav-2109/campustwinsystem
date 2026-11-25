import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { fmtDate } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ArticleFields } from "@/components/article-fields";
import { saveArticle } from "../actions";

export const metadata = { title: "Articles" };

export default async function Articles() {
  const { db, org } = await requireSetUp();
  const [{ data: rows }, { data: cats }, { data: s }] = await Promise.all([
    db.from("article").select("id, title, published, updated_at").eq("org_id", org.id).order("updated_at", { ascending: false }).limit(200),
    db.from("category").select("id, name").eq("org_id", org.id).eq("active", true).order("name"),
    db.from("settings").select("public_code").eq("org_id", org.id).single(),
  ]);
  return (
    <div>
      <PageHeader title="Articles" sub="Answers people can find on the help page before asking">
        {s && <a href={`/help/${s.public_code}`} target="_blank" rel="noreferrer" className={linkCls}>Open the help page</a>}
      </PageHeader>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Section flush>
          {rows?.length ? (
            <Table head={[{ label: "Article" }, { label: "Shown" }, { label: "Updated" }]}>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className={td}><Link href={`/articles/${a.id}`} className={linkCls}>{a.title}</Link></td>
                  <td className={td}>{a.published ? "On the help page" : "Hidden"}</td>
                  <td className={td}>{fmtDate(a.updated_at)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No articles yet. Answer the questions you get most often.</Empty>}
        </Section>
        <Section title="New article">
          <ActionForm action={saveArticle} className="space-y-3">
            <ArticleFields cats={cats ?? []} />
            <Submit className={btnPrimary} pending="Saving">Add article</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
