This facet is not a runtime-parser mirror. It owns root-manifest rules that
make later joins meaningful: canonical namespaces, route inventory, entry
consistency, route kind semantics, and cross-section invariants. Checks that
look like parsing belong here only when they gate those joins.

It treats the CAM manifest as the root contract between publishers, viewers,
and agents.

Root object and version checks are join gates. If they fail, later V1
namespace, resource, route, ABI, and UI joins do not run, because their
semantics are not established.
