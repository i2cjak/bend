// Experimental process-private checked-prefix cache around the stock checker.
// No persisted passes and no interface-only dependency assumptions.
import fs from "node:fs";
import path from "node:path";
import * as B from "./bend.ts";

type Module = {file: string; ns: string; start: number; end: number; hash: string; imports: string[]; aliases:Record<string,string>};
type Saved = {tlds: Record<string, any>; ctrs: Record<string, any>; tmps: [string, [string,string][]][]; hols: number};
type Cache = {entry: string; graph: string; interfaces: string; modules: Module[]; done: number; saved: Saved};

const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const canonical = (value: unknown) => JSON.stringify(value, (k,v) => k === "s" ? undefined : v);
const STOCK:Record<string,string>={
  'bend.ts':'1d133151652b597a1a035c77c172475e6de096da37f3b9e3adc23c2f75bdfe49',
  'comp.ts':'4e5ee824d2624eb8eb3ba408fd99671239e72759371e562f1a83d50bb614649a',
  'main.ts':'c07379114c706310a3838af100d47cf41ea6ce347c72a7e8eefcd55645e0d0c3',
  'safe.ts':'5ed16a964b75bf2c9f2719eab190119353d643ff58c9cc6640fd87f4609b1735',
  'base.bend':'99ac43f2b2bb3e3f39acdcedcecbbd3cb44749ce13969c827d6973fa66f7facf',
};

// Lower the entire reachable checkpoint before it can be reused. HOAS closures
// are never retained by the cache: later checking can mutate their share cells.
function save(book: B.Book, done: number, last: Map<string,number>): Saved {
  const plainDescriptors = (x:object, label:string) => {
    for(const key of Reflect.ownKeys(x)){
      const d=Object.getOwnPropertyDescriptor(x,key)!;
      if(typeof key!=="string" || !d.enumerable || !("value" in d))throw Error("uncacheable descriptor: "+label+"."+String(key));
    }
  };
  plainDescriptors(book.tlds,"tlds");plainDescriptors(book.ctrs,"ctrs");
  const tlds: Record<string,any> = Object.create(null);
  for (const [k,t] of Object.entries(book.tlds)) {
    if (last.has(k) && last.get(k)! >= done) continue;
    plainDescriptors(t,"tlds."+k);
    tlds[k] = t.$ === "ADT" ? {...t,T:B.term_lower(t.T),c:t.c.map(c=>({...c,T:B.term_lower(c.T)}))}
      : {...t,T:B.term_lower(t.T),v:t.v === null ? null : B.term_lower(t.v),
        e:t.e === undefined ? undefined : B.term_lower(B.term_higher(t.e))};
  }
  const ctrs = Object.fromEntries(Object.entries(book.ctrs).map(([k,c])=>[k,{...c,T:B.term_lower(c.T)}]));
  // structuredClone detaches all mutable cells, arrays and span/alias objects.
  const raw={tlds,ctrs,tmps:Object.entries(book.tmps).map(([k,m])=>[k,[...m]]),hols:book.hols};
  // span() stores the Parse object in Span.file although File's declared
  // interface is only str/ns/al. Its extra book field retains live HOAS and
  // the suffix. The frozen checker reads only file.str after parsing; retain
  // every declared File field and source offset, never the parser's machinery.
  const detached=new Map<object,any>();
  const copy=(value:any,label:string):any=>{
    if(typeof value==="function" || typeof value==="symbol")throw Error("uncacheable value: "+label);
    if(value===null || typeof value!=="object")return value;
    if(detached.has(value))return detached.get(value);
    const proto=Object.getPrototypeOf(value);
    if(!Array.isArray(value) && proto!==null && proto!==Object.prototype)throw Error("uncacheable prototype: "+label);
    const out=Array.isArray(value)?[]:Object.create(proto===null?null:Object.prototype);
    detached.set(value,out);
    const parser=typeof value.str==="string" && typeof value.ns==="string" && value.al && "book" in value && "pos" in value;
    for(const key of Reflect.ownKeys(value)){
      if(Array.isArray(value) && key==="length")continue;
      const d=Object.getOwnPropertyDescriptor(value,key)!;
      if(typeof key!=="string" || !d.enumerable || !("value" in d))throw Error("uncacheable descriptor: "+label+"."+String(key));
      if(parser && !["str","ns","al","book","dir","pos","stk","frs"].includes(key))throw Error("unknown parser field: "+key);
      if(parser && !["str","ns","al"].includes(key))continue;
      Object.defineProperty(out,key,{value:copy(d.value,label+"."+key),writable:true,enumerable:true,configurable:true});
    }
    return out;
  };
  const data=copy(raw,"checkpoint");
  const todo:[unknown,string][]=[[data,"checkpoint"]],visited=new Set<object>();
  while(todo.length){
    const [value,label]=todo.pop()!;
    if(typeof value==="function" || typeof value==="symbol")throw Error("uncacheable value: "+label+" ("+typeof value+")");
    if(value===null || typeof value!=="object" || visited.has(value))continue;
    visited.add(value);
    for(const [k,v] of Object.entries(value))todo.push([v,label+"."+k]);
  }
  const saved = structuredClone(data);
  const freeze = (x:any,seen=new Set<object>()) => {
    if(x===null || typeof x!=="object" || seen.has(x)) return;
    seen.add(x);for(const v of Object.values(x)) freeze(v,seen);Object.freeze(x);
  };
  freeze(saved);
  return saved;
}

function restore(book: B.Book, saved: Saved): void {
  const copy = structuredClone(saved);
  for (const [k,t] of Object.entries(copy.tlds)) {
    book.tlds[k] = t.$ === "ADT" ? {...t,T:B.term_higher(t.T),c:t.c.map((c:any)=>({...c,T:B.term_higher(c.T)}))}
      : {...t,T:B.term_higher(t.T),v:t.v === null ? null : B.term_higher(t.v)};
  }
  book.ctrs = Object.assign(Object.create(null),Object.fromEntries(Object.entries(copy.ctrs).map(([k,c])=>[k,{...c,T:B.term_higher(c.T)}])));
  book.tmps = Object.assign(Object.create(null),Object.fromEntries(copy.tmps.map(([k,entries])=>[k,new Map(entries)])));
  book.hols = copy.hols;
}

export class PrefixCache {
  #cache: Cache | null = null;
  constructor(readonly maxPrefixEvents = 2048) {
    for(const [name,sum] of Object.entries(STOCK)){
      if(hash(fs.readFileSync(path.join(B.BEND_DIR,name),'utf8'))!==sum)throw Error('prefix-cache: unaudited compiler consumer '+name);
    }
    for(const name of ['modules.ts','offload.ts'])if(fs.existsSync(path.join(B.BEND_DIR,name)))throw Error('prefix-cache: offloaded/module runtime is unsupported');
  }
  readonly #options = canonical({env:Object.fromEntries(Object.entries(process.env).sort()),cwd:process.cwd(),checker:hash(fs.readFileSync(B.BEND_DIR+"/bend.ts","utf8")),base:hash(fs.readFileSync(B.BASE_BEND,"utf8"))});

  async check(entry: string, observe = true): Promise<{book:B.Book; reused:number; total:number; reason:string; seconds:Record<string,number>}> {
    const options=canonical({env:Object.fromEntries(Object.entries(process.env).sort()),cwd:process.cwd(),checker:hash(fs.readFileSync(B.BEND_DIR+"/bend.ts","utf8")),base:hash(fs.readFileSync(B.BASE_BEND,"utf8"))});
    if(options!==this.#options){this.#cache=null;throw Error("prefix-cache: compiler/environment changed; start a fresh worker");}
    entry=fs.realpathSync(entry);
    const seconds:Record<string,number>={};let start=performance.now();
    const book=B.book_nil(),modules:Module[]=[];
    let end=0;
    const texts=new Map<string,string>();
    class Seen extends Map<string,string|null> {
      override set(file:string,ns:string|null) {
        super.set(file,ns);
        if(ns===null)texts.set(file,fs.readFileSync(file,'utf8'));
        else{
          const text=fs.readFileSync(file,"utf8");
          if(text!==texts.get(file))throw Error('prefix-cache: source changed while loading '+file);
          let source:B.File|undefined;
          for(const k of book.order.slice(end)){
            const t=book.tlds[k];
            const candidates=[t.T.s,t.$==='Def'?t.v?.s:undefined,...(t.$==='ADT'?t.c.map(c=>c.T.s):[])];
            source=candidates.find(s=>s?.file.ns===ns)?.file;
            if(source)break;
          }
          if(source){
            const lines=text.split('\n');
            for(let i=0;i<lines.length;i++){
              const line=lines[i].trim();if(!line || line.startsWith('#'))continue;
              if(!/^import(?:\s|$)/.test(line))break;lines[i]='';
            }
            if(source.str!==lines.join('\n'))throw Error('prefix-cache: parsed text does not match source '+file);
          }
          modules.push({file,ns,start:end,end:book.order.length,hash:hash(text),imports:text.split("\n").filter(l=>/^\s*import\b/.test(l)),aliases:{...source?.al}});end=book.order.length;
        }
        return this;
      }
    }
    await B.book_load(book,entry,"",new Seen());
    seconds.parse=(performance.now()-start)/1000;start=performance.now();
    const parseHoles=book.hols;
    const interfaces=hash(canonical(Object.entries(book.tlds).map(([k,t])=>t.$==="ADT"
      ? [k,t.$,t.n,t.g,t.b,B.term_lower(t.T),t.c.map(c=>[c.k,c.n,B.term_lower(c.T)])]
      : [k,t.$,t.n,t.x,t.b,t.u,t.i,t.m,B.term_lower(t.T)])));
    const graph=hash(canonical([this.#options,book.order,modules.map(({file,ns,start,end,imports,aliases})=>({file,ns,start,end,imports,aliases}))]));
    const last=new Map<string,number>();book.order.forEach((k,i)=>last.set(k,i));
    const boundary=modules.filter(m=>m.end>m.start && m.start<=this.maxPrefixEvents).at(-1)?.start ?? 0;
    const pending=[...last].some(([k,fin])=>fin>=boundary && book.order.indexOf(k)<boundary);
    let done=0,reason="cold";
    const cached=this.#cache;
    if(cached && cached.entry===entry && cached.graph===graph && cached.interfaces===interfaces && parseHoles===0 && !pending){
      const changed=modules.findIndex((m,i)=>m.hash!==cached.modules[i]?.hash);
      const earliest=changed<0 ? book.order.length : modules[changed].start;
      if(cached.done<=earliest){restore(book,cached.saved);done=cached.done;reason="checked-prefix";}
      else reason="changed-prefix";
    }else if(cached)reason="interface-graph-or-hole-change";
    seconds.lookup=(performance.now()-start)/1000;start=performance.now();
    // One checkpoint at a module boundary within the event budget. Serializing
    // the whole prefix can exceed a normal VM even when its cold check fits.
    let captured:Saved|null=null;
    if(parseHoles!==0 || pending){done=0;reason="full-book-required";}
    let active=false;
    const order=book.order;
    const observed = new Proxy(book,{
      set(target,key,value){Reflect.set(target,key,value);if(key==="tlds")active=true;return true;},
      get(target,key,receiver){
        if(key!=="order")return Reflect.get(target,key,receiver);
        return new Proxy(order,{get(xs,key,receiver){
          if(active && key===String(boundary) && !captured && !pending && parseHoles===0)captured=save(book,boundary,last);
          return Reflect.get(xs,key,receiver);
        }});
      },
    });
    try{
      B.book_valid(observe ? observed : book,done);
      if(book.hols)throw Error("unfilled TODOs: "+book.hols);
      if(captured)this.#cache={entry,graph,interfaces,modules,done:boundary,saved:captured};
      else if(observe)this.#cache=null;
    }catch(error){this.#cache=null;throw error;}
    seconds.check=(performance.now()-start)/1000;
    return {book,reused:done,total:order.length,reason,seconds};
  }
}
