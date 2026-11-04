import fs from 'node:fs';
import path from 'node:path';
const [stock,out]=process.argv.slice(2);
const B=await import(path.resolve(stock,'bend2/bend.ts'));
const C=await import(path.resolve(stock,'bend2/comp.ts'));
const {PrefixCache}=await import(path.resolve(stock,'bend2/prefix-cache.ts'));
const root=path.resolve(path.dirname(out),'fixtures');fs.mkdirSync(root,{recursive:true});
const cases=[
 {name:'conversion-body',a:'import Base\n\ndef two() -> Nat:\n  2n\n',b:'import Base\nimport ./A.bend as A\n\ndef claim() -> {A.two() == 2n : Nat}:\n  {==}\n',editFile:'A.bend',from:'2n',to:'3n'},
 {name:'false-proof',a:'import Base\n\ndef value() -> Nat:\n  2n\n',b:'import Base\nimport ./A.bend as A\n\ndef claim() -> {A.value() == 2n : Nat}:\n  {==}\n',editFile:'B.bend',from:'== 2n',to:'== 3n'},
 {name:'same-interface-body',a:'import Base\n\ndef value() -> U32:\n  2\n',b:'import Base\nimport ./A.bend as A\n\ndef next() -> U32:\n  (A.value() + 1 : U32)\n',editFile:'B.bend',from:'+ 1',to:'+ 2'},
 {name:'same-file-fill',a:'import Base\n\ndef value() -> Nat:\n  2n\n',b:'import Base\n\nlaw claim:\n  {2n == 2n : Nat}\n\ndef claim():\n  {==}\n',editFile:'B.bend',from:'2n == 2n',to:'2n == 3n'},
 {name:'pending-law',a:'import Base\n\nlaw claim:\n  {2n == 2n : Nat}\n',b:'import Base\nimport ./A.bend as A\n\ndef A.claim():\n  {==}\n',editFile:'B.bend',from:'{==}',to:'A.claim()'},
 {name:'prefix-template',a:'import Base\n\ndef id(~T: Type, x: T) -> T:\n  x\n\ndef first() -> U32:\n  id(U32, 3)\n',b:'import Base\nimport ./A.bend as A\n\ndef second() -> U32:\n  A.id(U32, 4)\n',editFile:'B.bend',from:'U32, 4',to:'U32, 5'},
 {name:'forward-reference',a:'import Base\n\ndef value() -> U32:\n  2\n',b:'import Base\n\ndef next() -> U32:\n  later()\n\ndef later() -> U32:\n  1\n',editFile:'B.bend',from:'1\n',to:'2\n'},
 {name:'prefix-TODO',a:'import Base\n\ndef value() -> U32:\n  ?TODO\n',b:'import Base\nimport ./A.bend as A\n\ndef next() -> U32:\n  A.value()\n',editFile:'B.bend',from:'A.value()',to:'3'},
 {name:'constructor-add',a:'import Base\n\ntype Choice is Data:\n  One{}\n',b:'import Base\nimport ./A.bend as A\n\ndef pick(c: A.Choice) -> U32:\n  match c:\n    case A.One{}: 1\n',editFile:'A.bend',from:'  One{}',to:'  One{}\n  Two{}'},
 {name:'prototype-names',a:'import Base\n\ndef constructor() -> U32:\n  2\n\ndef toString() -> U32:\n  3\n\ndef __proto__() -> U32:\n  4\n',b:'import Base\nimport ./A.bend as A\n\ndef value() -> U32:\n  (A.constructor() + A.__proto__() : U32)\n',editFile:'B.bend',from:'A.__proto__()',to:'A.toString()'},
 {name:'prefix-location',a:'import Base\n\ndef claim(x: U32) -> {x == 1 : U32}:\n  {==}\n',b:'import Base\nimport ./A.bend as A\n\ndef value() -> {2 == 1 : U32}:\n  A.claim(2)\n',editFile:'B.bend',from:'2 == 1',to:'3 == 1'},
 {name:'fill-before-user',a:'import Base\n\nlaw claim:\n  {2n == 2n : Nat}\n',b:'import Base\nimport ./A.bend as A\n\ndef A.claim():\n  {==}\n',extra:'import Base\nimport ./A.bend as A\n\ndef use() -> {2n == 2n : Nat}:\n  A.claim()\n',main:'import Base\nimport ./A.bend as A\nimport ./B.bend as B\nimport ./U.bend as U\n',editFile:'MAIN.bend',from:'import ./B.bend as B\nimport ./U.bend as U',to:'import ./U.bend as U\nimport ./B.bend as B'},
];
const results:any[]=[];
function diagnostic(e:any){return e?.$==='Err'?B.err_show(e):e instanceof Error?`${e.name}: ${e.message}`:String(e);}
function signature(book:any){const text=C.js_lib(book,true);return new Bun.CryptoHasher('sha256').update(text).digest('hex');}
async function stockCheck(entry:string){try{const book=B.book_nil();await B.book_load(book,entry,'',new Map());B.book_valid(book);if(book.hols)throw Error('unfilled TODOs: '+book.hols);return {pass:true,sha256:signature(book)};}catch(e){return {pass:false,diagnostic:diagnostic(e)};}}
for(const test of cases){
 const dir=path.join(root,test.name);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'A.bend'),test.a);fs.writeFileSync(path.join(dir,'B.bend'),test.b);
 if('extra' in test)fs.writeFileSync(path.join(dir,'U.bend'),test.extra!);
 const entry=path.join(dir,'MAIN.bend');fs.writeFileSync(entry,'main' in test?test.main!:'import Base\nimport ./A.bend as A\nimport ./B.bend as B\n');
 const cache=new PrefixCache();const target=path.join(dir,test.editFile),original=fs.readFileSync(target,'utf8');
 for(const phase of ['cold','reuse-1','reuse-2','changed','original-after-change']){
  fs.writeFileSync(target,phase==='changed'?original.replace(test.from,test.to):original);
  const want=await stockCheck(entry);let got:any,reused=0,reason='';
  try{const checked=await cache.check(entry,phase==='cold');reused=checked.reused;reason=checked.reason;got={pass:true,sha256:signature(checked.book)};
    if(phase==='reuse-1'){const key=Object.keys(checked.book.tlds).find(k=>checked.book.tlds[k].$==='Def'&&checked.book.tlds[k].e);if(key)checked.book.tlds[key].v=null;}
  }catch(e){got={pass:false,diagnostic:diagnostic(e)};}
  results.push({case:test.name,phase,want,got,reused,reason,equal:JSON.stringify(want)===JSON.stringify(got)});
 }
}
const differences=results.filter(r=>!r.equal);
fs.writeFileSync(out,JSON.stringify({results,differences},null,2));
console.log(JSON.stringify({controls:results.length,differences:differences.length,cacheHits:results.filter(r=>r.reused>0).length}));
if(differences.length)process.exitCode=1;
