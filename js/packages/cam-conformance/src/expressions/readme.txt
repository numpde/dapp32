This facet owns static expression references used across CAM routes and UI
documents: roots and fields promised by the surrounding protocol object.

It catches static expression/context mismatches before a viewer executes a
route or renders a UI tree, without resolving runtime values.

It distinguishes true dynamic expressions from escaped literal strings.
`$$foo` is data whose value starts with `$`, not an unresolved expression escape
hatch.
