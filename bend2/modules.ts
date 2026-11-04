// Experimental bounded-lifetime checking; the language checker is unchanged.
import * as fs from "node:fs";
import * as path from "node:path";
import * as Bend from "./bend.ts";
import { profile } from "./profile.ts";
import { TermStore } from "./offload.ts";

type Module = { file: string; ns: string; text: string };
export class FullBookRequired extends Error {}

// Plan local imports. Canonical LAWS/PROOF files, named packages, cycles and
// unfamiliar headers use the full checker. Module-local filled laws are still
// checked by the unchanged checker; unfilled/cross-file declarations fall back.
export function plan_modules(file: string, loaded: Map<string, string | null>): Module[] | null {
  const root = fs.realpathSync(file);
  const top = path.dirname(root);
  const active = new Set<string>();
  const done = new Set(loaded.keys());
  const ordered: Module[] = [];
  const visit = (name: string): boolean => {
    const real = fs.realpathSync(name);
    if (done.has(real)) return true;
    if (active.has(real) || (process.env.BP_BEND_PAGED !== "1"
      && ["LAWS.bend", "PROOF.bend"].includes(path.basename(real)))) return false;
    active.add(real);
    const text = fs.readFileSync(real, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (!/^import(?:\s|$)/.test(line)) break;
      if (/^import\s+Base\s*(?:#.*)?$/.test(line)) {
        if (!visit(Bend.BASE_BEND)) return false;
        continue;
      }
      const match = /^import\s+((?:\.\.?\/)[\w./-]+\.bend)\s+as\s+[A-Za-z_]\w*\s*(?:#.*)?$/.exec(line);
      if (!match || !visit(path.resolve(path.dirname(real), match[1]))) return false;
    }
    active.delete(real);
    done.add(real);
    ordered.push({ file: real, text, ns: real === root || real === Bend.BASE_BEND
      ? "" : path.relative(top, real).replace(/\.bend$/, "") });
    return true;
  };
  try {
    return visit(root) ? ordered : null;
  } catch {
    return null; // Canonical loader supplies the original error/diagnostic.
  }
}

// Rebuild checked interfaces through the same lower/higher conversion the
// parser already uses. Keep every body, erased term, flag and source span.
function compact(tld: Bend.TLD): void {
  tld.T = Bend.term_higher(Bend.term_lower(tld.T));
  if (tld.$ === "Def") {
    if (tld.v !== null) tld.v = Bend.term_higher(Bend.term_lower(tld.v));
  } else {
    for (const ctr of tld.c) ctr.T = Bend.term_higher(Bend.term_lower(ctr.T));
  }
}

// Check bounded groups with the canonical prefix API. Future declarations stay
// visible, but their unvalidated bodies are explicitly masked just as book_valid
// masks them in a whole-book check. A law and its final fill stay in one group.
async function check_paged(book: Bend.Book, start: number, store: TermStore, batch: number): Promise<void> {
  const order = book.order.slice();
  const last = new Map(order.map((name, index) => [name, index]));
  const future = new Map<string, Bend.TLD>();
  for (const name of order.slice(start)) future.set(name, book.tlds[name]);
  let cursor = start;
  let collectedAt = process.memoryUsage().rss;
  while (cursor < order.length) {
    let end = Math.min(order.length, cursor + batch);
    for (let i = cursor; i < end; i++) end = Math.max(end, last.get(order[i])! + 1);
    const group = new Set(order.slice(cursor, end));
    const tlds: Bend.Book["tlds"] = Object.create(null);
    for (const [name, tld] of Object.entries(book.tlds)) {
      tlds[name] = future.has(name) && !group.has(name) && tld.$ === "Def"
        ? { ...tld, v: null, e: undefined } : tld;
    }
    const checking = { ...book, tlds, order: order.slice(0, end) };
    profile("events:check:start", { from:cursor, to:end, names:[...group] });
    Bend.book_valid(checking, cursor);
    profile('events:validated', { from:cursor, to:end, names:[...group] });
    // The checker has returned; its temporary conversion contexts are dead.
    // Reclaim them before serializing a large accepted result, not afterwards.
    const checkedRSS = process.memoryUsage().rss;
    if (checkedRSS > 1536 * 1024 ** 2 && checkedRSS > collectedAt + 256 * 1024 ** 2) {
      await new Promise<void>(resolve => setImmediate(resolve));
      Bun.gc(true);
      collectedAt = process.memoryUsage().rss;
      profile('events:before-spill', { from:cursor, to:end });
    }
    store.replace(checking, Object.keys(checking.tlds).filter(name =>
      !future.has(name) || group.has(name)));
    for (const name of group) future.delete(name);
    for (const [name, tld] of future) checking.tlds[name] = tld;
    book.tlds = checking.tlds;
    book.ctrs = checking.ctrs;
    book.tmps = checking.tmps;
    book.hols = checking.hols;
    store.clear();
    // Yield at a validated boundary before collecting completed groups.
    await new Promise<void>(resolve => setImmediate(resolve));
    const rss = process.memoryUsage().rss;
    if (rss > collectedAt + 128 * 1024 ** 2) {
      Bun.gc(true);
      collectedAt = process.memoryUsage().rss;
    }
    profile("events:check:end", { from:cursor, to:end, names:[...group],
      stored_bytes:store.bytes, store_reads:store.reads });
    cursor = end;
  }
}

export async function check_modules(book: Bend.Book, file: string,
  seen: Map<string, string | null>, discardResults = false): Promise<boolean> {
  const modules = plan_modules(file, seen);
  if (modules === null) return false;
  const top = path.dirname(fs.realpathSync(file));
  const shouldCompact = process.env.BP_BEND_COMPACT === "1";
  const store = process.env.BP_BEND_PAGED === "1" ? new TermStore(32 * 1024 ** 2, discardResults) : null;
  const eventBatch = Number(process.env.BP_BEND_EVENT_BATCH ?? '8');
  if (!Number.isSafeInteger(eventBatch) || eventBatch < 1 || eventBatch > 128) {
    throw new Error('invalid bounded event batch');
  }
  let collectedAt = process.memoryUsage().rss;
  let count = 0;
  let pending: number | null = null;
  for (const module of modules) {
    if (fs.readFileSync(module.file, "utf8") !== module.text) {
      throw new Error("source changed during module planning: " + module.file);
    }
    const done = book.order.length;
    const previous = new Set(Object.keys(book.tlds));
    await Bend.book_load(book, module.file, module.ns, seen, undefined, top);
    const added = book.order.slice(done);
    // A declaration filled from a later file needs the full original book.
    // This also catches a law written after another declaration on one line.
    if (added.some(k => {
      const tld = book.tlds[k];
      return previous.has(k) || (tld.$ === "Def" && tld.v === null
        && tld.b !== true && !tld.i);
    })) {
      if (store === null) throw new FullBookRequired();
      pending ??= done;
    }
    // A bodiless law and its later fill must stay in the same check. Never
    // advance the validated prefix over a deferred event. Keep the complete
    // tail until the root loads, then check that tail in the original order.
    if (pending !== null && module !== modules[modules.length-1]) {
      profile("module:defer", { file: module.file, done, pending });
      count++;
      continue;
    }
    profile("module:check:start", { file: module.file, done: pending ?? done, added: added.length });
    if (store !== null) {
      await check_paged(book, pending ?? done, store, module.file === Bend.BASE_BEND ? 128 : eventBatch);
    } else {
      Bend.book_valid(book, pending ?? done);
    }
    pending = null;
    if (store !== null) {
      // Cleared bodies are no longer reachable through the book. Collect on
      // allocation growth, rather than repeating a major GC at every module
      // merely because the allocator retains its pages in RSS.
      store.clear();
      const rss = process.memoryUsage().rss;
      if (rss > collectedAt + 256 * 1024 ** 2) {
        Bun.gc(true);
        collectedAt = process.memoryUsage().rss;
      }
    } else if (shouldCompact) {
      for (const [name, tld] of Object.entries(book.tlds)) {
        if (!previous.has(name)) compact(tld);
      }
      // A phase boundary, not a changed heap/stack limit or omitted check.
      if (process.memoryUsage().rss > 3 * 1024 ** 3) Bun.gc(true);
    }
    profile("module:check:end", { file: module.file, definitions: Object.keys(book.tlds).length,
      added: added.length, compact: shouldCompact, paged: store !== null,
      stored_bytes: store?.bytes, store_writes: store?.writes, store_reads: store?.reads });
    count++;
  }
  for (const module of modules) {
    if (fs.readFileSync(module.file, "utf8") !== module.text) {
      throw new Error("source changed during module checking: " + module.file);
    }
  }
  profile("modules:complete", { files: count, discard_results: discardResults, compact: shouldCompact, paged: store !== null, stored_bytes: store?.bytes });
  return true;
}
