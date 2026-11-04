# Final JS assembly streaming experiment

**No demonstrated speed improvement or significant memory reduction; not wired into a production build.**

This stock-2.0.36 emitter experiment adds an optional chunk writer to `js_lib`. It writes the already-built function lines with indentation and tail-call markers resolved, in 64 KiB chunks, preserving the original output order and separators. The normal string-returning API is unchanged. It still retains the analysis state and emitted line arrays; it is not separate compilation or per-function IR release.

On a real 8,152-definition application prefix, three matched fresh-process runs gave cold median 5.493 s versus stock 5.621 s, and warmed one-file-edit median 5.594 s versus stock 5.412 s. Median cgroup peaks were 2.484/2.451 GB (cold/edit), versus stock 2.492/2.176 GB. Output bytes matched on all six application measurements and 26 focused upstream fixtures (18 accepted, eight intentionally rejected); full rejection diagnostics matched. n=3 timings overlap and support no speed claim. This is not full upstream or application qualification.

Runs used Bun 1.3.10 on one normal-size disposable Boat VM, one compiler at a time, own kernel-verified memory.max=3699998720, swap.max=0, native compiler flock and a separate 512 MiB controller. Cold means fresh compiler state, not flushed disk caches. Whole-library mjs output is not the production main-rooted hub build.

The parser, checker, Base and kernel are unchanged. Sanitized individual receipts and the shared fixture list are frozen with the numeric-emission experiment at [1db25859](https://github.com/i2cjak/bend/tree/1db25859/bench/hub-speed). Private application source and paths are not published. A useful next streaming design must release bulky analysis/IR, rather than only avoid a final string join.
