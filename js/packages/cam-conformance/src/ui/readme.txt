UI conformance belongs here.

This facet should validate CAM UI documents beyond basic parsing: named node
interfaces, element contracts, include wiring, button wiring, required
arguments, and compatibility between UI references and the route data they
consume.

It should keep UI documents renderer-independent while making them safe and
predictable for humans and agents.

It should reject deterministic UI failures: unknown literal nodes/routes,
invalid local state keys, incompatible known route outputs, incompatible known
literal handoffs, and cycles. It should not pretend that unknown runtime values
are statically typed. Those values become concrete only when a viewer resolves
the selected UI tree for a specific route, account, input set, and RPC result.
