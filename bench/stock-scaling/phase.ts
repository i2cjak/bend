// Observes unchanged upstream APIs; does not patch the parser, checker or emitter.
import * as fs from 'node:fs';
import * as path from 'node:path';
const [stock, entry, output, mode = 'mjs'] = process.argv.slice(2);
const B = await import(path.resolve(stock, 'bend2/bend.ts'));
const C = await import(path.resolve(stock, 'bend2/comp.ts'));
const book = B.book_nil();
function rss() {
  const s = fs.readFileSync('/proc/self/status', 'utf8');
  return {rss_kib: Number(/^VmRSS:\s+(\d+)/m.exec(s)![1]),
    peak_rss_kib: Number(/^VmHWM:\s+(\d+)/m.exec(s)![1])};
}
async function phase(name: string, fn: () => unknown) {
  fs.writeFileSync('/proc/self/clear_refs', '5'); // reset *only* RSS high-water accounting
  const start = rss();
  console.log(JSON.stringify({event:'start', phase:name, ...start}));
  const t = performance.now();
  await fn();
  const seconds = (performance.now() - t) / 1000;
  console.log(JSON.stringify({event:'end', phase:name, seconds, baseline_rss_kib:start.rss_kib, ...rss(),
    loaded_entries:book.order.length}));
}
try {
  await phase('parse', () => B.book_load(book, path.resolve(entry), '', new Map()));
  await phase('check', () => {B.book_valid(book); if(book.hols) throw Error('unfilled TODOs');});
  await phase('emit', () => fs.writeFileSync(output, mode === 'js' ? C.js_book(book) : C.js_lib(book, true)));
  console.log(JSON.stringify({event:'output',bytes:fs.statSync(output).size,
    loaded_defs:Object.values(book.tlds).filter((x:any)=>x.$==='Def').length,
    sha256:new Bun.CryptoHasher('sha256').update(fs.readFileSync(output)).digest('hex')}));
} catch (e: any) {
  // Bun's generic rendering of a thrown Bend.Err dumps its entire book.
  // Use the same renderer as the upstream CLI, never its generic object dump.
  const message = e?.$ === 'Err' ? B.err_show(e) : e instanceof Error ? e.message : typeof e === 'string' ? e : 'non-string exception';
  console.error(JSON.stringify({event:'failure', kind:e?.$ ?? typeof e, message:message.slice(0,8192)}));
  process.exitCode=1;
}
