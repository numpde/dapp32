Route conformance belongs here.

This facet should validate route-level contracts: declared inputs, call
arguments, read/write rules, continuation shape, route output expectations, and
statically knowable compatibility between CAM route declarations, ABI
functions, and UI handoff.

It should prove that route definitions are coherent before a viewer or agent
attempts to follow them.

It should not claim to prove concrete runtime values. Runtime adapters still
own exact ABI normalization for values supplied by inputs, state, wallets, RPC
decoders, and other dynamic sources.
