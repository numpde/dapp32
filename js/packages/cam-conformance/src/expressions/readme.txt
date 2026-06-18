Expression conformance belongs here.

This facet should validate that expressions used across CAM routes, UI nodes,
resource references, and action arguments resolve against the context promised
by the surrounding protocol object.

It should catch static expression/context mismatches before a viewer executes a
route or renders a UI tree.

It should distinguish true dynamic expressions from escaped literal strings.
`$$foo` is data whose value starts with `$`, not an unresolved expression escape
hatch.
