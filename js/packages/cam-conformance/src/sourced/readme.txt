Sourced conformance belongs here.

This facet should validate compatibility with rules owned by another CAM
package, such as @cam/core runtime parsing or @cam/screen UI parsing. These
checks are useful as cross-package compatibility evidence, but they should run
after granular author-facing conformance checks have had a chance to report
precise issues.

It should not own resource integrity, ABI semantics, UI node rules, or EVM
execution behavior.
