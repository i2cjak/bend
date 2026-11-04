// Exact dependency traversal shared by the verdict and bounded checked storage.
// This records references from accepted results, never a proof-pass cache.
import type * as Bend from './bend.ts';
const checked = new WeakMap<object, ReadonlySet<string>>();
export function checked_refs(tld: Bend.TLD): ReadonlySet<string> | undefined {
  return checked.get(tld);
}
export function save_checked_refs(tld: object, term: Bend.LTerm | undefined): void {
  if (term === undefined) { checked.delete(tld); return; }
  const refs = new Set<string>(); term_refs(term,refs); checked.set(tld,refs);
}
export function set_checked_refs(tld: object, refs: ReadonlySet<string>): void {
  checked.set(tld, new Set(refs));
}

// term_refs adds to out the names a term (a span skipped) refers to.
export function term_refs(t: object, out: Set<string>, shared?: WeakSet<object>): void {
  const seen = shared ?? new Set<object>();
  if (seen.has(t)) return;
  seen.add(t);
  for (const todo = [t]; todo.length > 0;) {
    const x = todo.pop() as Record<string, unknown>;
    if ((x.$ === "Ref" || x.$ === "ADT") && typeof x.k === "string") {
      out.add(x.k);
    }
    for (const f in x) {
      const v = x[f];
      if (f !== "s" && typeof v === "object" && v !== null && !seen.has(v)) {
        seen.add(v);
        todo.push(v);
      }
    }
  }
}

