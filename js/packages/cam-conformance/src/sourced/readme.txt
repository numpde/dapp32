This facet normalizes caller-supplied bytes into raw values before the granular
conformance facets run. It does not call runtime parsers as fallback validators;
parser acceptance belongs in the owning runtime package tests, while
conformance owns explicit static publication rules with author-facing paths.

It does not own resource integrity, UI node rules, or EVM execution behavior.
ABI resource and route-wiring checks live in the ABI facet, where they can stay
static and adapter-free.
