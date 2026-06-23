This facet owns CAM UI publication facts beyond basic parsing: named node
interfaces, element contracts, include wiring, button wiring, required
arguments, and compatibility between UI references and route data they consume.

It keeps UI documents renderer-independent while making them safe and
predictable for humans and agents.

It rejects deterministic UI failures: unknown literal nodes/routes, invalid
local state keys, incompatible known route outputs, incompatible known literal
handoffs, and cycles. It does not pretend that unknown runtime values are
statically typed. Those values become concrete only when a viewer resolves the
selected UI tree for a specific route, account, input set, and RPC result.

Document-level checks own the UI version, top-level closed-world shape, and
node inventory needed by the conformance facets. Do not mirror the renderer's
full parser here just to get another copy of parser errors. Promote a renderer
shape rule into conformance only when it is a publication invariant with a
better static author location, such as call wiring, node interfaces, or props
whose type can be proven from known route data.
