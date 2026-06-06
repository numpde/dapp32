ABI conformance belongs here.

This facet should validate the ABI resources that CAM namespaces reference:
function shape, mutability, named input/output wiring, supported ABI type
surfaces, tuple structure, and the parts of ABI semantics that CAM route and
write declarations rely on.

It checks static ABI-backed wiring. It is not complete runtime typechecking:
dynamic expressions and literal strings still become concrete values only when
the EVM adapter prepares a read, simulation, or write. Exact address, bytes, and
integer validation belongs at that runtime boundary.

It should not execute contracts or depend on an EVM client.
