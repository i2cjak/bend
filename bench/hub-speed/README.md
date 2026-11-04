# Emitter search short-circuit experiment

**No demonstrated speed improvement; not wired into a production build.**

This stock-2.0.36 experiment lets `term_any` return after a successful predicate before opening the term's children. It changes only the emitter, not the parser, checker, Base or kernel.

On a real 8,152-definition application prefix, three matched fresh-process runs gave cold median 5.643 s versus stock 5.621 s, and warmed one-file-edit median 5.520 s versus stock 5.412 s. Median cgroup peaks were 2.499/2.481 GB (cold/edit), versus stock 2.492/2.176 GB. Output bytes matched on all six application measurements and 26 focused upstream fixtures (18 accepted, eight intentionally rejected); full rendered rejection diagnostics matched too. This is not the full upstream gate.

Runs were on one normal-size disposable Boat VM, Bun 1.3.10, own kernel-verified memory.max=3699998720, swap.max=0, native compiler flock and separate 512 MiB controller. Cold means fresh process, not flushed disk caches. Whole-library mjs emission is not the production main-rooted hub build. n=3 timings overlap and support no improvement claim.

Sanitized individual receipts and the shared fixture list are frozen with the numeric-emission experiment at [1db25859](https://github.com/i2cjak/bend/tree/1db25859/bench/hub-speed). Private application source and paths are not published. This branch is retained as a negative experimental result; the short-circuit can alter probe-allocation side effects in cases beyond those tested, so broader byte equality is not assumed.
