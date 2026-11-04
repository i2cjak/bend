// Optional local compiler diagnostics. Never changes checking or emitted code.
import * as fs from "node:fs";
import { heapStats } from "bun:jsc";

const target = process.env.BP_COMPILER_PROFILE;
const started = performance.now();
let sampledRSS = 0;
let lastTick = -1e9;
let cgroup: string | null = null;
try {
  const group = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n')
    .find(line => line.startsWith('0::'))?.slice(3);
  if (group && !group.split('/').includes('..')) cgroup = '/sys/fs/cgroup' + group;
} catch {}

function groupMemory(): Record<string, number> | null {
  if (cgroup === null) return null;
  try {
    const stats = Object.fromEntries(fs.readFileSync(cgroup + '/memory.stat', 'utf8')
      .trim().split('\n').map(line => { const [key, value] = line.split(' '); return [key, Number(value)]; }));
    return { current: Number(fs.readFileSync(cgroup + '/memory.current', 'utf8')),
      peak: Number(fs.readFileSync(cgroup + '/memory.peak', 'utf8')),
      anon: stats.anon, file: stats.file, kernel: stats.kernel };
  } catch { return null; }
}

export function profile(phase: string, details: Record<string, unknown> = {}): void {
  if (!target) return;
  const memory = process.memoryUsage();
  const perDefinition = phase.startsWith("jsdef:");
  if (phase === "analysis:tick") {
    if (performance.now() - lastTick < 2000) return;
    lastTick = performance.now();
  } else if (perDefinition && memory.rss < sampledRSS + 32 * 1024 * 1024) return;
  sampledRSS = Math.max(sampledRSS, memory.rss);
  const heap = !perDefinition && process.env.BP_COMPILER_CENSUS === "1" ? heapStats() : null;
  const usage = process.resourceUsage();
  fs.appendFileSync(target, JSON.stringify({
    phase, seconds: (performance.now() - started) / 1000,
    rss_bytes: memory.rss, max_rss_kib: usage.maxRSS,
    heap_used_bytes: memory.heapUsed, heap_total_bytes: memory.heapTotal,
    external_bytes: memory.external, jsc_heap_bytes: heap?.heapSize,
    jsc_capacity_bytes: heap?.heapCapacity, jsc_extra_bytes: heap?.extraMemorySize,
    jsc_objects: heap?.objectCount,
    jsc_top: heap ? Object.entries(heap.objectTypeCounts as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 14) : undefined, cgroup_memory: groupMemory(), ...details,
  }) + "\n");
}
