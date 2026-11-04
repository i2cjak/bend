# Stock Bend phase measurements

Measured with unmodified upstream sources on normal Boat VMs (4 vCPU, advertised 8 GB; guest reports 7 GiB), Linux 6.8, Bun 1.3.10. Each compiler scope enforces `memory.max=3699998720` bytes and `memory.swap.max=0`, with a 120 s command timeout. The campaign controller has a separate 512 MiB cap. No compiler patches, paged storage or module-mode experiments are used.

Three fresh-process repetitions per case; tables show medians of successful phase completions. `s / MiB` means wall seconds / process peak RSS in that phase. RSS includes retained state from prior phases; it is not incremental allocation. Failed or incomplete phases have no invented wall/peak value.

The source runner calls unchanged `book_load`, `book_valid`, and `js_lib(book, true)` in that order. Parse/load includes imports, Base and elaboration; emit includes backend analysis, JS generation and writing an `.mjs` library exporting all host-callable definitions. It is not the hub application entry-point bundle. Startup/import time is outside phase timers.

Linux `/proc/self/clear_refs` value 5 resets RSS high-water accounting before each phase; `/proc/self/status` supplies the peak at completion. This does not drop pages, force GC or reset cgroup memory accounting. Do not treat the raw wait4 child peak after these resets as a whole-process high-water mark. Whole-scope memory.peak is separately recorded.

## Synthetic results

Each input has exactly N source definitions, plus the fixed Base library. Identifiers have fixed width. Independent bodies do one U32 addition; fan-in bodies call the preceding function and function floor(i/2). No generated program is executed. All definitions are rooted for library emission.

### v2.0.36, independent

| Definitions | Input bytes | Parse s / MiB | Check s / MiB | Emit s / MiB |
|---:|---:|---:|---:|---:|
| 2000 | 98013 | 0.0374 / 112.9 | 0.0367 / 137.3 | 0.1255 / 205.9 |
| 4000 | 196013 | 0.0526 / 127.1 | 0.0489 / 161.0 | 0.2028 / 244.1 |
| 8000 | 392013 | 0.0822 / 139.4 | 0.1102 / 217.9 | 0.4262 / 355.6 |
| 16000 | 784013 | 0.1405 / 195.4 | 0.1465 / 284.9 | 0.6966 / 554.1 |
| 32000 | 1568013 | 0.2558 / 241.3 | 0.2427 / 381.4 | 1.4456 / 900.4 |

### v2.0.36, fanin

| Definitions | Input bytes | Parse s / MiB | Check s / MiB | Emit s / MiB |
|---:|---:|---:|---:|---:|
| 2000 | 133977 | 0.0413 / 116.7 | 0.0443 / 141.1 | 0.1190 / 198.5 |
| 4000 | 267977 | 0.0661 / 123.2 | 0.0780 / 189.0 | 0.2492 / 259.3 |
| 8000 | 535977 | 0.0971 / 163.3 | 0.1295 / 244.5 | 0.4450 / 388.8 |
| 16000 | 1071977 | 0.1884 / 207.9 | 0.1837 / 314.2 | 0.8386 / 598.8 |
| 32000 | 2143977 | 0.2870 / 264.0 | 0.2918 / 420.7 | 1.6246 / 1051.0 |

### v2.0.39, independent

| Definitions | Input bytes | Parse s / MiB | Check s / MiB | Emit s / MiB |
|---:|---:|---:|---:|---:|
| 2000 | 98013 | 0.0421 / 114.7 | 0.0388 / 146.3 | 0.0764 / 180.2 |
| 4000 | 196013 | 0.0548 / 119.5 | 0.0498 / 157.8 | 0.1383 / 210.2 |
| 8000 | 392013 | 0.0841 / 152.7 | 0.0992 / 228.4 | 0.2833 / 313.9 |
| 16000 | 784013 | 0.1466 / 204.1 | 0.1569 / 289.4 | 0.5155 / 440.1 |
| 32000 | 1568013 | 0.2408 / 249.8 | 0.2272 / 395.0 | 0.9284 / 684.7 |

### v2.0.39, fanin

| Definitions | Input bytes | Parse s / MiB | Check s / MiB | Emit s / MiB |
|---:|---:|---:|---:|---:|
| 2000 | 133977 | 0.0436 / 118.8 | 0.0471 / 147.5 | 0.0871 / 185.6 |
| 4000 | 267977 | 0.0665 / 126.6 | 0.0768 / 186.3 | 0.1998 / 238.5 |
| 8000 | 535977 | 0.1282 / 173.1 | 0.1378 / 241.1 | 0.4090 / 363.8 |
| 16000 | 1071977 | 0.1845 / 214.2 | 0.1891 / 324.7 | 0.6994 / 557.8 |
| 32000 | 2143977 | 0.3092 / 277.2 | 0.3175 / 437.7 | 1.4202 / 964.5 |

## Fits

OLS on log(median metric) versus log(size), `metric ~ size^p`. Parentheses are descriptive 95% percentile intervals from 2,000 resamples of the three repetitions within each size. They describe same-VM run variability, not confidence about asymptotic complexity or other machines. Entirely/partly censored size groups are excluded from fits. Fixed Base/JIT work can push measured slopes below one. RSS exponent fits and fits against source bytes are also in results.json.

| Family | Version | Parse p | Check p | Emit p |
|---|---|---:|---:|---:|
| Independent defs | v2.0.36 | 0.70 (0.56–0.72) | 0.70 (0.53–0.77) | 0.88 (0.80–0.94) |
| Independent defs | v2.0.39 | 0.65 (0.61–0.72) | 0.68 (0.64–0.71) | 0.91 (0.87–0.97) |
| Fan-in defs | v2.0.36 | 0.71 (0.67–0.78) | 0.67 (0.65–0.73) | 0.93 (0.90–1.04) |
| Fan-in defs | v2.0.39 | 0.71 (0.60–0.78) | 0.68 (0.61–0.75) | 0.99 (0.92–1.03) |
| Current real prefixes | v2.0.36 | 1.20 (1.18–1.29) | 0.87 (0.79–1.05) | 1.02 (0.98–1.08) |
| Current real prefixes | v2.0.39 | 0.82 (0.77–0.85) | 0.94 (0.81–1.77) | 1.43 (0.73–1.86) |
| Older real prefixes | v2.0.36 | 1.31 (1.21–1.36) | 1.44 (1.43–1.57) | 1.67 (1.60–1.97) |
| Older real prefixes | v2.0.39 | 1.87 (1.74–2.02) | 1.48 (1.33–1.54) | insufficient uncensored sizes |
| String cases | v2.0.36 | 0.64 (0.54–0.67) | 0.49 (0.28–0.60) | 0.61 (0.46–0.65) |
| String cases | v2.0.39 | 0.55 (0.50–0.63) | 0.47 (0.40–0.52) | 0.62 (0.59–0.66) |

No quadratic definition-count growth was established in these synthetic families. The private real prefixes change code composition as well as size: some observed slopes exceed one, but this is not an isolated compiler-complexity result. The current 2.0.39 real emit fit, for example, is 1.43 with a 0.73–1.86 within-VM resampling interval, over only three completed sizes. Do not turn these observations into a general claim that stock Bend is linear or superlinear.

## Current private hub closure

An exact snapshot contains 365 imported modules, 32,482 explicit source defs and 9,390,430 source bytes. A DFS import traversal chooses the nearest dependency-closed complete-module prefixes; no declarations are rewritten or stubbed. Import order follows the original DFS order. Input files, effect companions and hashes are retained privately; no application source is published. Source-def counts exclude Base, type declarations and generated/template defs. Loaded entry counts are available for completed phases.

### v2.0.36

| Source defs | Source bytes | Parse s / MiB | Check s / MiB | Emit s / MiB | Outcome |
|---:|---:|---:|---:|---:|---|
| 2031 | 471650 | 0.2093 / 186.1 | 0.2104 / 258.6 | 0.9073 / 553.6 | PASS 3/3 |
| 3981 | 1092483 | 0.6465 / 335.2 | 0.6493 / 704.1 | 2.9131 / 1575.5 | PASS 3/3 |
| 8152 | 1941176 | 0.6460 / 376.4 | 0.7133 / 818.2 | 3.7576 / 2130.7 | PASS 3/3 |
| 16148 | 4006262 | 3.4270 / 1476.3 | 3.9061 / 3216.9 (2/3) | — | OOM 3/3 at 3.7 GB cgroup cap |
| 32482 | 9390430 | — | — | — | OOM 3/3 at 3.7 GB cgroup cap |

### v2.0.39

| Source defs | Source bytes | Parse s / MiB | Check s / MiB | Emit s / MiB | Outcome |
|---:|---:|---:|---:|---:|---|
| 2031 | 471650 | 0.2393 / 175.8 | 0.2195 / 262.1 | 0.8905 / 689.1 | PASS 3/3 |
| 3981 | 1092483 | 0.6681 / 344.1 | 0.6318 / 713.4 | 2.5189 / 1973.8 | PASS 3/3 |
| 8152 | 1941176 | 0.7506 / 385.1 | 0.8151 / 790.3 | 6.5125 / 2270.1 | PASS 3/3 |
| 16148 | 4006262 | — | — | — | Tool/Base duplicate name, 3/3 |
| 32482 | 9390430 | — | — | — | Tool/Base duplicate name, 3/3 |

At 16,148 defs, 2.0.36 reached checking in all attempts: two finished checking and were killed in emit; one was killed in check. At 32,482 defs all three attempts were killed during parse/load. systemd recorded `Result=oom-kill` and `MemoryPeak=3699998720` for all six failures. 2.0.39 rejects both larger inputs during parsing because the application declares Tool, which collides with its Base library; those are compatibility failures, not scaling samples.

The named root checkout was older (218 modules, 23,963 source defs). It was measured too, with prefixes 2,072 / 3,993 / 8,175 / 16,200 / 23,963. Those numeric results remain in results.json. Failed scopes in that first retained series lack a systemd outcome readback and are marked unclassified, not asserted OOMs. Different private snapshots and VMs must not be used as compiler before/after comparisons.

## Additional string-pattern probe

Two fixed definitions, with 2 / 4 / 8 / 16 / 32 literal string cases in dispatch. All completed on both stock versions. This small probe did not isolate a superlinear compiler bug; its raw phase measurements are included, not used as evidence of the paged prototype’s behavior.

## Observation overhead and controls

At 32,000 independent definitions, median whole-process harness/unchanged CLI times were 1.993/1.978 s (2.0.36) and 1.445/1.374 s (2.0.39). These are separate runs, not a precision overhead estimate. All three CLI controls and all three harness outputs matched byte for byte at both 2,000 and 32,000 defs for each version. Checksums are in results.json. No full application output identity or proof qualification is implied.

The published dataset comes only from completed measurement campaigns with retrieved artifacts. An earlier discarded attempt let Bun render a thrown compiler error object, producing an oversized book dump; the harness now uses upstream err_show on failure. Diagnostic rendering and failed runs are not fitted as compile phases.

Historical reports of hub compilation using 13–18 GB and proof work around 18 GB remain unmatched observations, not measurements reproduced by this capped campaign. Separate compilation with sound interfaces, streaming emission and incremental caching remain worthwhile design questions; these measurements do not qualify any experimental compiler branch.
