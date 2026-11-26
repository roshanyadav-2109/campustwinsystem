"use client";
import { readSpreadsheet, SpreadsheetError } from "@/lib/xlsx-read";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { cn } from "@/lib/utils";
import { parseCsv } from "@/app/dashboard/students/manage/rules";
import { importBooks, saveBook, setBookActive } from "@/app/dashboard/library/actions";
import {
  BULK_HEADERS, CATEGORY_SUGGESTIONS, availabilityText, cleanBook, tdCls, thCls,
  type BookInput, type BookStock,
} from "./shared";

// The catalogue table. Everyone sees availability; only the office (canEdit)
// gets the add, edit and deactivate controls.
export function CatalogueTable({ rows, canEdit, categories }: { rows: BookStock[]; canEdit: boolean; categories: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BookStock | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(b: BookStock) {
    setProblem(null);
    start(async () => {
      const res = await setBookActive(b.id, !b.is_active); if (res.ok) router.refresh();
      if (!res.ok) setProblem(res.error);
    });
  }

  return (
    <>
      {problem && <p role="alert" className="px-4 pt-3 text-[13px] font-medium text-down">{problem}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-hair">
              <th className={thCls}>Accession no</th>
              <th className={thCls}>Title</th>
              <th className={thCls}>Category</th>
              <th className={thCls}>Shelf</th>
              <th className={thCls}>Availability</th>
              {canEdit && <th className={thCls}><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className={cn("border-b border-hair last:border-b-0", !b.is_active && "bg-panel")}>
                <td className={cn(tdCls, "tabular whitespace-nowrap")}>{b.accession_no}</td>
                <td className={tdCls}>
                  <div className="font-medium">{b.title}</div>
                  <div className="text-[12px] text-ink-500">
                    {[b.author, b.publisher, b.language, b.isbn ? `ISBN ${b.isbn}` : null].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className={tdCls}>{b.category}</td>
                <td className={tdCls}>{b.shelf || "—"}</td>
                <td className={cn(tdCls, "whitespace-nowrap")}>
                  {!b.is_active ? (
                    <span className="text-ink-500">Not in use</span>
                  ) : (
                    <span className={cn("font-medium", b.copies_available > 0 ? "text-up" : "text-down")}>{availabilityText(b)}</span>
                  )}
                </td>
                {canEdit && (
                  <td className={cn(tdCls, "whitespace-nowrap text-right")}>
                    <Button size="sm" variant="subtle" onClick={() => setEditing(b)}>Edit</Button>{" "}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(b)}>
                      {b.is_active ? "Deactivate" : "Bring back"}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Dialog title="Edit book" onClose={() => setEditing(null)}>
          <BookForm book={editing} categories={categories} onDone={() => setEditing(null)} />
        </Dialog>
      )}
    </>
  );
}

// "Add book" and "Add many books" buttons with their dialogs (office only).
export function CatalogueActions({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState<"one" | "many" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {notice && <span className="text-[13px] font-medium text-up">{notice}</span>}
      <Button size="sm" variant="subtle" onClick={() => { setNotice(null); setOpen("many"); }}>Add many books</Button>
      <Button size="sm" onClick={() => { setNotice(null); setOpen("one"); }}>Add book</Button>
      {open === "one" && (
        <Dialog title="Add book" onClose={() => setOpen(null)}>
          <BookForm book={null} categories={categories} onDone={() => { setOpen(null); setNotice("Book added."); }} />
        </Dialog>
      )}
      {open === "many" && (
        <Dialog title="Add many books" onClose={() => setOpen(null)}>
          <BulkAdd onDone={(message) => { setOpen(null); setNotice(message); }} />
        </Dialog>
      )}
    </div>
  );
}

function BookForm({ book, categories, onDone }: { book: BookStock | null; categories: string[]; onDone: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [f, setF] = useState({
    accessionNo: book?.accession_no ?? "",
    title: book?.title ?? "",
    author: book?.author ?? "",
    publisher: book?.publisher ?? "",
    isbn: book?.isbn ?? "",
    category: book?.category ?? "",
    language: book?.language ?? "",
    shelf: book?.shelf ?? "",
    copies: String(book?.copies_total ?? 1),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const options = [...new Set([...categories, ...CATEGORY_SUGGESTIONS])];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { errors } = cleanBook(f);
    if (errors.length) { setProblem(`${errors[0]}.`); return; }
    setProblem(null);
    start(async () => {
      const res = await saveBook({ id: book?.id ?? null, ...f }); if (res.ok) router.refresh();
      if (res.ok) onDone(); else setProblem(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Accession no" hint="The number written on the book, for example B-00123.">
          <Input value={f.accessionNo} onChange={set("accessionNo")} maxLength={30} required />
        </Field>
        <Field label="Copies" hint={book && book.copies_out > 0 ? `${book.copies_out} out right now.` : undefined}>
          <Input type="number" min={0} max={9999} step={1} value={f.copies} onChange={set("copies")} required />
        </Field>
      </div>
      <Field label="Title"><Input value={f.title} onChange={set("title")} maxLength={200} required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Author"><Input value={f.author} onChange={set("author")} maxLength={150} required /></Field>
        <Field label="Publisher (optional)"><Input value={f.publisher} onChange={set("publisher")} maxLength={150} /></Field>
        <Field label="Category">
          <Input value={f.category} onChange={set("category")} maxLength={60} list={listId} required />
          <datalist id={listId}>{options.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Language (optional)"><Input value={f.language} onChange={set("language")} maxLength={40} /></Field>
        <Field label="ISBN (optional)"><Input value={f.isbn} onChange={set("isbn")} maxLength={20} /></Field>
        <Field label="Shelf (optional)"><Input value={f.shelf} onChange={set("shelf")} maxLength={40} /></Field>
      </div>
      {problem && <p role="alert" className="text-[13px] font-medium text-down">{problem}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : book ? "Save changes" : "Add book"}</Button>
      </div>
    </form>
  );
}

type BulkRow = { line: number; book: BookInput; errors: string[] };

// Rows copied from Excel arrive separated by tabs; a saved CSV uses commas.
function toCells(text: string): string[][] {
  if (text.includes("\t")) return text.replace(/\r/g, "").split("\n").map((l) => l.split("\t"));
  return parseCsv(text);
}

function readBulk(text: string): BulkRow[] {
  const cells = toCells(text).filter((r) => r.some((c) => c.trim() !== ""));
  const hasHeader = cells.length > 0 && /accession/i.test(cells[0][0] ?? "");
  const seen = new Set<string>();
  return cells.slice(hasHeader ? 1 : 0).map((c, i) => {
    const { book, errors } = cleanBook({
      accessionNo: c[0], title: c[1], author: c[2], publisher: c[3], isbn: c[4],
      category: c[5], language: c[6], shelf: c[7], copies: c[8],
    });
    if (book.accessionNo) {
      if (seen.has(book.accessionNo)) errors.push("Accession number appears twice");
      seen.add(book.accessionNo);
    }
    return { line: i + 1, book, errors };
  });
}

function downloadTemplate() {
  // The BOM makes Excel open the file as UTF-8, so Hindi titles survive.
  const blob = new Blob(["﻿" + BULK_HEADERS.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "library-books-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function BulkAdd({ onDone }: { onDone: (message: string) => void }) {
  const router = useRouter();
  const inputId = useId();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function check(source: string) {
    setProblem(null);
    const parsed = readBulk(source);
    if (!parsed.length) { setRows(null); setProblem("No rows were found."); return; }
    if (parsed.length > 1000) { setRows(null); setProblem("Please add at most 1000 books at a time."); return; }
    setRows(parsed);
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setRows(null);
    if (file.size > 2 * 1024 * 1024) { setProblem("This file is too big. Please add at most 1000 books at a time."); return; }
    try {
      // Show what was read in the box (one row per line), then check it.
      const cells = await readSpreadsheet(file, parseCsv);
      const content = cells.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
      setText(content);
      check(content);
    } catch (e) {
      setProblem(e instanceof SpreadsheetError ? e.message : "We could not read this file. Please check it is an Excel or CSV file.");
    }
  }

  const good = rows?.filter((r) => !r.errors.length) ?? [];
  const bad = rows ? rows.length - good.length : 0;

  function run() {
    setProblem(null);
    start(async () => {
      const res = await importBooks(good.map((r) => r.book)); if (res.ok) router.refresh();
      if (!res.ok) { setProblem(res.error); return; }
      const parts = [`${res.added} ${res.added === 1 ? "book" : "books"} added`];
      if (res.skipped) parts.push(`${res.skipped} already in the catalogue, left as they were`);
      onDone(`${parts.join(", ")}.`);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-ink-900">
        One book per row, in this order: <span className="font-medium">{BULK_HEADERS.join(", ")}</span>.{" "}
        <button type="button" onClick={downloadTemplate} className="font-medium text-[#0F6CBD] hover:underline">Download template</button>
      </p>
      <Field label="Paste rows from Excel">
        <Textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setRows(null); }}
          placeholder={"B-00123\tThe Jungle Book\tRudyard Kipling\tPuffin\t\tFiction\tEnglish\tA-3\t2"} className="font-mono text-[12px]" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="subtle" onClick={() => check(text)} disabled={!text.trim() || pending}>Check rows</Button>
        <span className="text-[13px] text-ink-500">or</span>
        <label htmlFor={inputId}
          className="inline-flex h-10 cursor-pointer items-center rounded-sm border border-hair bg-panel px-4 text-[14px] font-medium text-ink-900 hover:bg-gold-100">
          Choose an Excel or CSV file
        </label>
        <input id={inputId} type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only"
          onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {problem && <p role="alert" className="text-[13px] font-medium text-down">{problem}</p>}

      {rows && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-ink-900">
              <span className="font-semibold tabular">{good.length}</span> ready
              {bad > 0 && <>, <span className="font-semibold tabular text-down">{bad}</span> <span className="text-down">with problems, will be skipped</span></>}
            </p>
            <Button disabled={!good.length || pending} onClick={run}>
              {pending ? "Adding…" : `Add ${good.length} ${good.length === 1 ? "book" : "books"}`}
            </Button>
          </div>
          <div className="mt-2 max-h-72 overflow-auto rounded-sm border border-hair">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-hair text-left text-ink-700">
                  <th className="px-3 py-1.5 font-semibold">Row</th>
                  <th className="px-3 py-1.5 font-semibold">Accession no</th>
                  <th className="px-3 py-1.5 font-semibold">Title</th>
                  <th className="px-3 py-1.5 font-semibold">Category</th>
                  <th className="px-3 py-1.5 font-semibold">Copies</th>
                  <th className="px-3 py-1.5 font-semibold">Check</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => Number(!a.errors.length) - Number(!b.errors.length) || a.line - b.line).slice(0, 300).map((r) => (
                  <tr key={r.line} className={cn(r.errors.length > 0 && "bg-down-soft")}>
                    <td className="px-3 py-1 tabular">{r.line}</td>
                    <td className="px-3 py-1 tabular">{r.book.accessionNo || "—"}</td>
                    <td className="px-3 py-1">{r.book.title || "—"}</td>
                    <td className="px-3 py-1">{r.book.category || "—"}</td>
                    <td className="px-3 py-1 tabular">{Number.isFinite(r.book.copies) ? r.book.copies : "—"}</td>
                    <td className="px-3 py-1">
                      {r.errors.length ? <span className="font-medium text-down">{r.errors.join(". ")}</span> : <span className="font-medium text-up">Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 300 && <p className="mt-1 text-[13px] text-ink-500">Showing the first 300 of {rows.length} rows. All good rows will be added.</p>}
        </div>
      )}
    </div>
  );
}
