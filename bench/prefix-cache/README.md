# Checked-prefix cache: rejected build experiment

**Experimental, unwired and slower on the real workload. Do not use it as a trusted compiler cache or proof gate.** Nothing is persisted or accepted from external passes. No stock parser/checker/kernel file is edited, and the CLI does not import this module.

`bend2/prefix-cache.ts` explores reuse around stock `book_valid(book, done)` without changing the checker. It observes a completed module boundary, serializes a successfully checked prefix, and rechecks the suffix against that state. It fingerprints ordered global declarations, actual parsed import/alias context, source contents, the entry and namespaces. Generated template definitions outside `book.order`, template-map insertion order and holes are carried. Cross-boundary pending laws and parse-time holes refuse prefix reuse. Declaration/import/ordering changes fall back to a complete stock check; changed compiler/environment requires a fresh worker. Compiler/Base/consumer hashes are pinned to the audited stock 2.0.36, and module/offload runtimes are refused.

Live HOAS graphs could not simply be cloned: elaborated annotations contain functions, and source spans retain the parser object, including its whole Book. The prototype lowers terms, projects span files to their declared `str/ns/al` interface while preserving offsets and sharing, makes one detached graph clone, deep-freezes it, and reconstructs a fresh replay with null-prototype tables. It refuses unexpected accessors/properties/prototypes. This is a research representation change, not a proof that every stock state can be round-tripped. The source audit found source-text/namespace/alias consumers; no equality of raw parser objects is claimed. Separate offload experiments already make the same File projection; no novel paging fix or retained-size reduction is claimed here.

All runs were on normal disposable Boat VMs, kernel-read memory.max=3699998720 bytes, memory.swap.max=0, native compiler flock, separate 512 MiB controller, Bun 1.3.10. No local compiler/test runs or larger-memory fallback were used. The real workload is the same private dependency-closed 8,152-definition / 75-module whole-library mjs application prefix used by the numeric-emission experiment. Source and paths are excluded.

Matched single-VM n=1 results with a 2,048-event checkpoint budget (2,000 events actually reused):

| Result | Stock | Prefix serialization |
|---|---:|---:|
| Cold complete build wall | 5.463 s | 9.056 s |
| Cold cgroup peak | 3.037 GB | 3.421 GB |
| Warm body-edit checker only | 0.502 s | 0.295 s |
| Warm body-edit total before emit | 1.082 s | 1.827 s |
| Warm original-after-edit final emit | completed | OOM at 3.7 GB |

The completed cold files have identical UTF-8 SHA-256. The warm candidate never produced a complete output: no whole warm-build speedup or byte-equality qualification exists. Larger checkpoints also OOM-killed before first reuse. Cloning, hashing and reparsing outweighed the saved checking. A 10–100x speedup has not been demonstrated. Reuse should target compiled units rather than repeated bulk prefix serialization; that architecture is separate work.

`controls.ts` contains 60 focused differential comparisons, including 22 actual reuses, repeated reuse, mutated-then-original suffixes, caller-returned-book corruption, body-dependent conversion, false proofs, fill order, forward references, holes, template reuse, prototype-like names and constructor additions. Verdicts, exact rendered diagnostics and emitted bytes matched stock in all 60. These are a small corpus, not general soundness, independent-template composition, concurrent-edit, full upstream/kernel, or large-application qualification. Clone failures before successful reuse remain failed probes, not passes.

The performance measurements used prefix-cache source SHA-256 `cd714fbf3766b90aec0dacca7b5be17a563b18df24f1980c29afcbc527bc2d28`; the current version subsequently adds consumer hash pins and source/alias stability guards. Its 60 controls were rerun at SHA-256 `9f46158d8f29c3e07545388e243b47bcb175a9fe3d557bff45b31c909b3df467`. Timings were not repeated for the added guards because the approach is already rejected. `results.json` preserves sanitized individual timing/cap records and failure classifications.

Reproducing the controls requires a fresh, audited, normal Boat worker with a verified cap, zero swap and the actual native compiler flock **before** launching Bun. In that worker, `bun bench/prefix-cache/controls.ts . /tmp/prefix-results.json` uses the pinned local compiler. The controls do not establish execution admission on their own. Never run the experiment on the machine hosting user work.
