# Separate compilation: research notes

These notes describe experiments with the Bend 2.0.36 checker, not a completed compiler feature.

A possible unit is a module or mutually dependent group with an exact ordered checked prefix. A sound interface must preserve fully elaborated dependent types, constructor information and every body that definitional equality can unfold. It must also bind the compiler, base library, source and relevant options, imported effects, ordered law declarations and fills, and the identities of dependencies. Unsupported or missing context must reject the unit or use the original whole-book checker.

Small fixtures showed that a consumer can pass against a parse-only prefix even when a dependency contains a false proof or type error. Every dependency therefore needs its own authenticated checked evidence, and the conjunction must cover the full ordered context. Load order matters: a law fill loaded before a consumer can change its verdict even where the consumer does not directly import the filler.

Templates add generated definitions outside the ordinary definition order. Independent units starting with empty template state can assign the same generated name to different instances. An interface must preserve the exact template and generated-definition state and ordering, or establish an equivalent naming scheme; linking must reject a same-name, different-definition collision.

A future linker must preserve reachability, output order, tail-recursion layout, first-use counters, effect resolution, and program-level wrappers. Compare against the unmodified compiler byte for byte or establish equivalence. Small assembled-book tests matched on selected fixtures and deliberately refused the template collision; they did not test cross-process interfaces, a separate emitter, full proofs, or a full application. No interface format or production cache is qualified yet.
