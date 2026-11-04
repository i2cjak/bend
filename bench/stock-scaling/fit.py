"""Reproduce descriptive wall-time growth fits from sanitized raw records."""
import json,math,random,statistics,sys

def slope(points):
    xs=[math.log(n) for n,t in points];ys=[math.log(t) for n,t in points]
    xm=statistics.mean(xs);ym=statistics.mean(ys)
    return sum((x-xm)*(y-ym) for x,y in zip(xs,ys))/sum((x-xm)**2 for x in xs)

def main():
    data=json.load(open(sys.argv[1]))
    for series,version,shape in sorted({(r['series'],r['version'],r['shape']) for r in data['records'] if not r['cli']}):
        rows=[r for r in data['records'] if (r['series'],r['version'],r['shape'])==(series,version,shape) and not r['cli']]
        for phase in ('parse','check','emit'):
            groups=[]
            for n in sorted({r['n'] for r in rows}):
                rs=[r for r in rows if r['n']==n]
                ts=[e['seconds'] for r in rs for e in r['phases'] if e['phase']==phase]
                if len(ts)==len(rs) and len(ts)>=3:groups.append((n,ts))
            if len(groups)<3:continue
            p=slope([(n,statistics.median(ts)) for n,ts in groups])
            rng=random.Random(2038)
            boots=sorted(slope([(n,statistics.median(rng.choices(ts,k=len(ts)))) for n,ts in groups]) for _ in range(2000))
            print(json.dumps({'series':series,'version':version,'shape':shape,'phase':phase,'p':p,'within_vm_resampling_95':[boots[49],boots[1949]],'sizes':[n for n,ts in groups]}))

if __name__=='__main__':main()
