// Experimental storage for terms already accepted by the unchanged checker.
// This is process-private spill storage, never a persisted proof-pass cache.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { serialize, deserialize } from "node:v8";
import { StringDecoder } from "node:string_decoder";
import * as Bend from "./bend.ts";
import { profile } from "./profile.ts";
import { save_checked_refs, set_checked_refs, term_refs } from "./references.ts";

const bodies = new WeakMap<object, boolean>();
export function stored_body(tld: Bend.TLD): boolean | undefined {
  return bodies.get(tld);
}

type Stored = { value: unknown; bytes: number };

export class TermStore {
  readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-checked-terms-"));
  private files = new WeakMap<object, string>();
  private parsedFiles = new Set<Bend.File>();
  private decodedFiles = new Map<string, Bend.File>();
  private loaded = new Map<string, Stored>();
  private loadedBytes = 0;
  private accesses = 0;
  private interfaces: Bend.HTerm[] = [];
  private interfaceIds = new WeakMap<object, number>();
  private readonly identity = randomBytes(16).toString('hex');
  private replaced = new WeakSet<object>();
  writes = 0;
  reads = 0;
  bytes = 0;

  constructor(private limit = 32 * 1024 ** 2, private discardResults = false) {
    // Do not leave process-private checked state reusable after a failed run.
    process.once("exit", () => fs.rmSync(this.directory, { recursive: true, force: true }));
  }

  private digest(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private put(value: unknown): string {
    // Binary structured serialization preserves graph sharing. JSON would
    // expand each repeated lower subtree even after annotation interning.
    const bytes = serialize(value);
    const key = this.digest(bytes);
    const target = path.join(this.directory, key);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
      this.writes++;
      this.bytes += bytes.length;
    }
    return key;
  }

  private get(key: string): { value: any; bytes: number } {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid checked-term identity");
    const bytes = fs.readFileSync(path.join(this.directory, key));
    if (this.digest(bytes) !== key) throw new Error("checked-term storage changed");
    this.reads++;
    return { value: deserialize(bytes), bytes: bytes.length };
  }

  private span(span: Bend.Span): unknown {
    this.parsedFiles.add(span.file);
    let key = this.files.get(span.file);
    if (key === undefined) {
      // A parser's File is a Parse object containing its whole Book. Only these
      // three File fields belong to diagnostics; never serialize Parse.book.
      key = this.put({ str: span.file.str, ns: span.file.ns, al: span.file.al });
      this.files.set(span.file, key);
    }
    return { "@span": key, beg: span.beg, end: span.end };
  }

  private interface(target: object, term: Bend.HTerm): void {
    // Keep the exact interface graph accepted by the kernel. Lowering and
    // reconstructing signatures discards sharing that conversion relies on.
    Object.defineProperty(target, 'T', { value: term, writable: true,
      enumerable: false, configurable: true });
    if (term.s !== undefined) this.parsedFiles.add(term.s.file);
  }

  private detachParsedFiles(): void {
    // Called only after book_load has returned for this module. Span.file's
    // public File contract is str/ns/al; the completed parser's extra Book
    // pointer must not retain obsolete full AST tables through an interface.
    for (const file of this.parsedFiles) {
      const parser = file as Bend.File & { book?: Bend.Book };
      if (Object.hasOwn(parser, 'book') && !delete parser.book) {
        throw new Error('cannot release completed parser book');
      }
    }
    this.parsedFiles.clear();
  }

  private registerInterface(value: Bend.HTerm): string {
    if (value === null || typeof value !== 'object') throw new Error('invalid higher interface');
    const old = this.interfaceIds.get(value);
    if (old !== undefined) {
      const previous = this.interfaces[old] as any;
      const entries = Object.entries(value);
      if (entries.length === Object.keys(previous).length && entries.every(([k,v]) => Object.is(previous[k], v))) return String(old);
    }
    // Snapshot the root fields, retaining its higher-order binders and shared
    // children. Trusted kernel share-cell normalization preserves their meaning;
    // opening/cloning all those closures here defeats the memory boundary.
    const key = this.interfaces.length;
    this.interfaces.push({ ...value } as Bend.HTerm);
    this.interfaceIds.set(value, key);
    if (value.s !== undefined) this.parsedFiles.add(value.s.file);
    return String(key);
  }

  private putTerm(term: Bend.LTerm, refs: Set<string>): string {
    const temporary = path.join(this.directory, '.term-' + this.writes);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let written = 0;
    let chunks: string[] = [];
    let buffered = 0;
    const flush = () => {
      if (!chunks.length) return;
      const bytes = Buffer.from(chunks.join('')); chunks = []; buffered = 0;
      for (let at = 0; at < bytes.length;) at += fs.writeSync(fd, bytes, at, bytes.length-at);
      hash.update(bytes); written += bytes.length;
    };
    const line = (value: unknown) => {
      const text = JSON.stringify(value) + '\n'; chunks.push(text); buffered += text.length;
      if (buffered >= 1024 * 1024) flush();
    };
    const ids = new WeakMap<object, number>();
    const higherRefs = new WeakSet<object>();
    const queue: any[] = [];
    const ref = (value: any): any => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'object') throw new Error('unsupported checked graph value');
      let id = ids.get(value);
      if (id === undefined) { id = queue.length; ids.set(value,id); queue.push(value); }
      return { r:id, a:Array.isArray(value) };
    };
    try {
      const root = ref(term);
      line({ format:'bend-lower-graph-1', store:this.identity, root });
      for (let id=0; id<queue.length; id++) {
        const value = queue[id];
        if ((value.$ === 'Ref' || value.$ === 'ADT') && typeof value.k === 'string') refs.add(value.k);
        if (Array.isArray(value)) line({ i:id, a:true, v:value.map(ref) });
        else {
          const fields: [string,unknown][] = [];
          for (const [key,item] of Object.entries(value)) {
            if (item === undefined) continue;
            if (value.$ === 'Var' && key === 'v') term_refs(item as object, refs, higherRefs);
            fields.push([key, key === 's' ? this.span(item as Bend.Span)
              : value.$ === 'Var' && key === 'v' ? { '@interface':this.registerInterface(item as Bend.HTerm) } : ref(item)]);
          }
          line({ i:id, a:false, o:fields });
        }
        queue[id] = null;
      }
      line({ count:queue.length }); flush();
      const key = hash.digest('hex');
      const target = path.join(this.directory,key);
      fs.closeSync(fd);
      if (fs.existsSync(target)) fs.unlinkSync(temporary);
      else { fs.renameSync(temporary,target); this.writes++; this.bytes += written; }
      return key;
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      fs.rmSync(temporary,{force:true}); throw error;
    }
  }

  private getTerm(key: string): { value:Bend.LTerm; bytes:number } {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid checked-term identity');
    const fd = fs.openSync(path.join(this.directory,key),'r');
    const buffer = Buffer.alloc(64*1024);
    const nodes: any[] = [];
    let count = 0, footer = false, root: any, header = false;
    const resolve = (value: any): any => {
      if (value === null || typeof value !== 'object') return value;
      if (Object.hasOwn(value,'r')) {
        const id = value.r;
        if (!Number.isSafeInteger(id) || id < 0 || typeof value.a !== 'boolean') throw new Error('invalid graph reference');
        const existing = nodes[id];
        if (existing !== undefined && Array.isArray(existing) !== value.a) throw new Error('graph reference kind changed');
        return nodes[id] ??= value.a ? [] : {};
      }
      if (Object.hasOwn(value,'@span') || Object.hasOwn(value,'@interface')) return this.decode(value);
      throw new Error('unknown checked graph value');
    };
    const accept = (text: string) => {
      const row = JSON.parse(text);
      if (!header) {
        if (row.format !== 'bend-lower-graph-1') throw new Error('unsupported checked graph');
        if (row.store !== this.identity) throw new Error('checked graph belongs to another process store');
        root = resolve(row.root); header = true; return;
      }
      if (footer) throw new Error('trailing checked graph data');
      if (Object.hasOwn(row,'count')) {
        if (row.count !== count || nodes.length !== count) throw new Error('incomplete checked graph');
        footer = true; return;
      }
      if (row.i !== count || typeof row.a !== 'boolean') throw new Error('invalid checked graph node order');
      const node = resolve({r:count,a:row.a}); count++;
      if (row.a) {
        if (!Array.isArray(row.v)) throw new Error('invalid checked graph array');
        for (const item of row.v) node.push(resolve(item));
      } else {
        if (!Array.isArray(row.o)) throw new Error('invalid checked graph object');
        for (const pair of row.o) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') throw new Error('invalid graph field');
          Object.defineProperty(node,pair[0],{value:resolve(pair[1]),writable:true,enumerable:true,configurable:true});
        }
      }
    };
    try {
      const before = createHash('sha256'); let position=0;
      for (;;) {
        const n = fs.readSync(fd,buffer,0,buffer.length,position); if (!n) break;
        before.update(buffer.subarray(0,n)); position += n;
      }
      if (before.digest('hex') !== key) throw new Error('checked-term storage changed');
      const bytes=position, after=createHash('sha256'), decoder=new StringDecoder('utf8');
      let pending=''; position=0;
      for (;;) {
        const n=fs.readSync(fd,buffer,0,buffer.length,position); if (!n) break;
        const chunk=buffer.subarray(0,n); after.update(chunk); position += n;
        pending += decoder.write(chunk);
        let end;
        while ((end=pending.indexOf('\n')) >= 0) { accept(pending.slice(0,end)); pending=pending.slice(end+1); }
      }
      pending += decoder.end();
      if (pending || !header || !footer || after.digest('hex') !== key) throw new Error('incomplete or changed checked graph');
      this.reads++;
      return {value:root,bytes};
    } finally { fs.closeSync(fd); }
  }

  private decode(value: any, objects = new WeakMap<object, any>()): any {
    if (value === null || typeof value !== "object") return value;
    const existing = objects.get(value);
    if (existing !== undefined) return existing;
    if (Array.isArray(value)) {
      const out: any[] = []; objects.set(value, out);
      for (const item of value) out.push(this.decode(item, objects));
      return out;
    }
    if (Object.hasOwn(value, "@interface")) {
      const key = value['@interface'];
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error('invalid checked interface handle');
      const higher = this.interfaces[Number(key)];
      if (higher === undefined) throw new Error('missing checked interface handle');
      return higher;
    }
    if (Object.hasOwn(value, "@span")) {
      const key = value["@span"];
      let file = this.decodedFiles.get(key);
      if (file === undefined) {
        const raw = this.get(key).value;
        file = { str: raw.str, ns: raw.ns, al: Object.assign(Object.create(null), raw.al) };
        this.decodedFiles.set(key, file);
      }
      return { file, beg: value.beg, end: value.end };
    }
    const out: Record<string, unknown> = {};
    objects.set(value, out);
    for (const [key, item] of Object.entries(value)) out[key] = this.decode(item, objects);
    return out;
  }

  private read(key: string, higher: boolean): any {
    if (++this.accesses % 2048 === 0) profile('store:access', {
      accesses: this.accesses, disk_reads: this.reads, loaded_bytes: this.loadedBytes,
      cached_results: this.loaded.size,
    });
    const id = (higher ? "H:" : "L:") + key;
    let hit = this.cached(id);
    if (hit === undefined) {
      const raw = this.getTerm(key);
      const term = raw.value;
      hit = { value: higher ? Bend.term_higher(term) : term, bytes: raw.bytes * 4 };
    }
    this.remember(id, hit);
    return hit.value;
  }

  private cached(id: string): Stored | undefined {
    return this.loaded.get(id);
  }

  private remember(id: string, hit: Stored): void {
    if (!this.loaded.has(id)) this.loadedBytes += hit.bytes;
    else this.loaded.delete(id);
    this.loaded.set(id, hit);
    if (typeof hit.value !== 'object' || hit.value === null) throw new Error('checked term is not an object');
    while (this.loadedBytes > this.limit && this.loaded.size > 1) {
      const oldest = this.loaded.keys().next().value!;
      this.loadedBytes -= this.loaded.get(oldest)!.bytes;
      this.loaded.delete(oldest);
    }
  }

  private field(target: object, name: string, term: Bend.HTerm | Bend.LTerm | null | undefined,
    higher: boolean): void {
    if (higher) throw new Error('only checked lower results may be spilled');
    const refs = new Set<string>();
    const key = term == null ? null : this.putTerm(term as Bend.LTerm, refs);
    if (term != null) set_checked_refs(target, refs);
    this.attach(target, name, key, term === null ? null : undefined, higher);
  }

  private retainBody(target: object, value: Bend.HTerm | null): void {
    // Retain the parser's exact higher-order body. Re-lowering its branching
    // closures can expand a small source DAG into a huge tree. Checked results
    // (e) are already lower terms and can be spilled without that conversion.
    let body = value;
    Object.defineProperty(target, 'v', { enumerable: false, configurable: true,
      get: () => body,
      set: value => { body = value; bodies.set(target, value !== null); },
    });
    if (value?.s !== undefined) this.parsedFiles.add(value.s.file);
  }

  // A separate activation cannot retain field()'s original full term through
  // the accessor closure, even before the JS engine optimizes that closure.
  private attach(target: object, name: string, key: string | null,
    absent: null | undefined, higher: boolean): void {
    let assigned = false;
    let override: unknown;
    Object.defineProperty(target, name, {
      // book_valid makes temporary bodiless prefix placeholders by spreading a
      // Def. The prefix is restored before any new event checks. Do not hydrate
      // every already-checked T/v/e merely to make those temporary placeholders.
      enumerable: false, configurable: true,
      get: () => assigned ? override : key === null ? absent : this.read(key, higher),
      set: value => {
        assigned = true;
        override = value;
        if (name === "v") bodies.set(target, value !== null);
        if (name === "e") save_checked_refs(target, value);
      },
    });
  }

  replace(book: Bend.Book, names: string[]): void {
    for (const name of names) {
      const original = book.tlds[name];
      if (this.replaced.has(original)) continue;
      if (process.env.BP_COMPILER_SPILL_PROFILE === '1') profile('spill:start', { name });
      const { T, ...metadata } = original;
      let next: Bend.TLD;
      if (original.$ === "Def") {
        const { v, e, ...flags } = metadata as Bend.Def;
        next = flags as Bend.Def;
        bodies.set(next, original.v !== null);
        this.interface(next, T);
        if (process.env.BP_COMPILER_SPILL_PROFILE === '1') profile('spill:body', { name });
        this.retainBody(next, original.v);
        if (process.env.BP_COMPILER_SPILL_PROFILE === '1') profile('spill:result', { name });
        if (original.e !== undefined) {
          if (this.discardResults) {
            save_checked_refs(next, original.e);
            // The unchanged checker accepted the entire event group. Its e
            // result is only emitter IR; proofs and later checking use T/v.
            // No emit/run/BendTT CLI path requests this storage mode.
            delete original.e;
            Object.defineProperty(next, 'e', { enumerable:false, configurable:true,
              get: () => { throw new Error('emitter IR not retained for check-only book'); },
              set: value => save_checked_refs(next, value),
            });
          } else this.field(next, "e", original.e, false);
        }
      } else {
        const { c, ...flags } = metadata as Bend.ADT;
        const cs = original.c.map(ctr => {
          const fresh = { k: ctr.k, n: ctr.n } as Bend.Ctr;
          this.interface(fresh, ctr.T);
          book.ctrs[ctr.k] = fresh;
          return fresh;
        });
        next = { ...flags, c: cs } as Bend.ADT;
        this.interface(next, T);
      }
      book.tlds[name] = next;
      this.replaced.add(next);
      if (process.env.BP_COMPILER_SPILL_PROFILE === '1') profile('spill:end', {
        name, stored_bytes: this.bytes, retained_interfaces: this.interfaces.length,
      });
    }
    this.detachParsedFiles();
  }

  clear(): void {
    this.loaded.clear();
    this.loadedBytes = 0;
  }
}
