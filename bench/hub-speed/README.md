# Direct numeric JS emission experiment

Experimental fork of stock Bend 2.0.36, not a production compiler pin or upstream PR.

The JS emitter previously expanded a checked U32/F32 literal into its constructor view (including a 32-bit word tree), then recovered the numeric word to print JavaScript. This patch reads the already-checked word and uses exactly the same numeric formatting. It changes only `js_expr` in `comp.ts`; the parser, checker, Base and kernel are unchanged.

A CPU profile of an 8,152-definition / 75-module dependency-closed application prefix attributed roughly 75% of sampled compiler CPU to emission. A diagnostic constructor counter found 14.73 million Ctr allocations during emission, with word_to_term/lit_step dominating sampled constructor stacks. The diagnostic excludes arrays/strings/closures and is not a byte-allocation profile. Application source is private and is not included here.

Matched measurements used Bun 1.3.10 on one normal-size disposable Boat VM (4 vCPUs), one compiler at a time, three repetitions with randomized compiler order. Each compiler had its own kernel-verified memory.max=3699998720 bytes and memory.swap.max=0; the separate controller was capped at 512 MiB. Cold means fresh compiler state, not flushed disk caches. The edit adds one U32-returning definition to the application-prefix entry; each rebuild is a fresh process. These are whole-library `.mjs` emits, not the production main-rooted hub `.js` build.

| Compiler | Cold median wall | Edit median wall | Cold median peak | Edit median peak |
|---|---:|---:|---:|---:|
| Stock 2.0.36 | 5.621 s | 5.412 s | 2.492 GB | 2.176 GB |
| Numeric-literal patch | 4.899 s | 5.134 s | 1.858 GB | 1.903 GB |

Cold speedup: 1.15x (13% less wall time), median peak memory 25% lower. Edit speedup: 1.05x. With n=3 and overlapping timing ranges, speed estimates remain tentative. All six candidate outputs are byte-identical to their matching stock outputs. Stock 2.0.39 was also measured, but its different runtime/output is not a byte-identity comparator for this patch. Sanitized individual receipts are in `results.json`.

The 26 existing upstream fixtures listed in `fixture-cases.json` were checked and emitted through unchanged APIs for stock and the candidate. Eighteen pass; eight intentionally reject (termination, false constructor/literal typing, and invalid argument controls). Verdicts, full rendered error diagnostics and emitted bytes match in all 26 cases. This is focused differential evidence, not the full upstream test suite or kernel gate. Full application compilation is not qualified under the cap.

Two other independently hash-verified patches were measured: short-circuiting emitter searches and streaming the final JS assembly. Both matched the real-prefix bytes and the 26 fixtures, but neither showed a convincing speed gain. Their records are included to avoid selecting only favorable results.

An earlier campaign accidentally skipped patches because git apply ran inside a nested worktree directory; it was rejected, and none of its candidate results appear here. The accepted campaign applied patches with patch -p1 and verified each comp.ts SHA-256 before executing it. The source hashes in results.json bind the tested candidates.
