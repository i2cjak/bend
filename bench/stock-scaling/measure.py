"""Measure ONE input in an already enforced Linux memory/swap scope.

Use a disposable normal-size Boat VM, not the machine hosting your work.
"""
import argparse,hashlib,json,os,resource,subprocess,time
from pathlib import Path
from generate import source

def cgroup():
    p=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
    return {n:(p/n).read_text().strip() for n in ('memory.max','memory.swap.max','memory.peak','memory.events')}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('stock',type=Path);ap.add_argument('shape',choices=['independent','fanin','patterns']);ap.add_argument('n',type=int);ap.add_argument('out',type=Path);ap.add_argument('--cli',action='store_true');ap.add_argument('--bun',default='bun');a=ap.parse_args()
    before=cgroup()
    if before['memory.max']=='max' or not 0<int(before['memory.max'])<=3_700_000_000 or before['memory.swap.max']!='0':
        raise SystemExit('Refused: own cgroup must enforce memory.max <= 3700000000 and memory.swap.max = 0')
    if a.n<1:ap.error('n must be positive')
    resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(536_870_912,536_870_912));resource.setrlimit(resource.RLIMIT_STACK,(1024**3,1024**3))
    a.out.mkdir(parents=True,exist_ok=False)
    entry=a.out/'input.bend';entry.write_text(source(a.shape,a.n));output=a.out/'output.mjs'
    stock=a.stock.resolve();here=Path(__file__).resolve().parent
    cmd=[a.bun,str(stock/'bend2/main.ts'),str(entry.resolve()),'-o',str(output.resolve())] if a.cli else [a.bun,str(here/'phase.ts'),str(stock),str(entry.resolve()),str(output.resolve())]
    env=dict(os.environ,BEND_NO_TELEMETRY='1',BUN_JSC_maxPerThreadStackUsage='4000000000')
    t=time.monotonic()
    with (a.out/'stdout.txt').open('w') as so,(a.out/'stderr.txt').open('w') as se:
        p=subprocess.run(['timeout','--signal=TERM','--kill-after=5','120',*cmd],env=env,stdout=so,stderr=se)
    result={'rc':p.returncode,'wall_seconds':time.monotonic()-t,'before':before,'after':cgroup(),'input_bytes':entry.stat().st_size,'input_sha256':hashlib.sha256(entry.read_bytes()).hexdigest(),'child_peak_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}
    if output.exists():result['output_sha256']=hashlib.sha256(output.read_bytes()).hexdigest()
    (a.out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print((a.out/'stdout.txt').read_text(),end='');print(json.dumps(result));return p.returncode

if __name__=='__main__':raise SystemExit(main())
