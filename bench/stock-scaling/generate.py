"""Generate the public synthetic inputs. No application source is needed."""
import argparse
from pathlib import Path

def source(shape,n):
    if shape=='patterns':
        lines=['import Base\n\ndef consume(s: String, n: U32) -> U32:\n  n\n\ndef dispatch(+s: String) -> U32:\n  match s:\n']
        lines += [f'    case "key{i:04d}": consume(s, {i})\n' for i in range(n)]
        return ''.join(lines)+ '    case +other: consume(other, 999)\n'
    lines=['import Base\n\n']
    for i in range(n):
        body=f'(x + {i%997:03d} : U32)' if shape=='independent' or i<2 else f'(f{i-1:07d}(x) + f{i//2:07d}(x) : U32)'
        lines.append(f'def f{i:07d}(+x: U32) -> U32:\n  {body}\n\n')
    return ''.join(lines)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('shape',choices=['independent','fanin','patterns']);p.add_argument('n',type=int);p.add_argument('out',type=Path);a=p.parse_args()
    if a.n<1:p.error('n must be positive')
    a.out.write_text(source(a.shape,a.n))
