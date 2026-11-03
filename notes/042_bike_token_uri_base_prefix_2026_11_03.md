# Bike token URI base prefix

Date: 2026-11-03

Status: decision note. No contract, deployment or live configuration was
changed or inspected for this note. See note 041 for the separate shared URI
and nested NFT metadata design.

## Current behavior

`BicycleComponents` stores a collection-wide `baseTokenURI`. Its public
`baseURI()` reads that value, and `setBaseURI()` permits an account with
`CONFIGURER_ROLE` to change it. The contract delegates `tokenURI()` to
OpenZeppelin's `ERC721URIStorage`: when both base and stored per-token suffix
are nonempty, the result is their concatenation. With an empty base, the
result is the stored per-token URI itself.

Bike's manager passes the URI supplied for registration or metadata updates
to the relevant component token contract. The view reads the resulting
`tokenURI`. Consequently, with a nonempty base:

- A supplied complete URI, including `data:`, can resolve to `base + URI`.
- An edit that sends a previously read resolved URI as the new suffix can
  resolve to `base + base + suffix`.

These follow from the checked-in source; the UI consequences have not yet been
reproduced in a nonempty-base fixture. The local Bike fixture sets the base to
empty. That does not establish the configuration or behavior of any other
existing deployment.

Sources: `dapps/bike-nft/src/BicycleComponents.sol`,
`dapps/bike-nft/src/BicycleComponentManager.sol`,
`dapps/bike-nft/src/BicycleComponentManagerUI.sol`, and
`dapps/dependencies/@openzeppelin-contracts-5.6.1/token/ERC721/extensions/ERC721URIStorage.sol`.

## Deployment choice and limit

For the current contract, an empty base at deployment lets a complete per-token
URI—including HTTPS, IPFS or embedded `data:`—be returned unchanged **while the
base remains empty**. This supports independent per-token locations. It is a
configuration choice, not an immutable invariant: the configured role can
change the base later, affecting the resolved URIs of existing tokens.

A viewer's pre-signing base read is a snapshot. It cannot prevent an authorized
base change before execution or afterward. A post-transaction `tokenURI` read
shows the result at that read, not a guarantee of future behavior. For
registration, the relevant collection is the manager's selected component
collection at execution; for an existing component, use the component's recorded
token contract, which may differ from the current collection.

## Long-term direction

For a future collection designed around complete per-token URIs, prefer an
explicit contract invariant: `tokenURI(tokenId)` returns the complete URI stored
for that token, without a mutable collection prefix. Specify and test that
behavior at the contract boundary rather than asking every renderer to guess
whether a value is a suffix or a full URI.

This is a recommendation for a future contract, not a claim that the current
contract can be upgraded. `BicycleComponents` is not upgradeable. A new
collection has a different address and does not automatically move existing
NFTs, ownership, approvals or manager records. A migration or replacement
requires a separately designed and authorized plan. Do not change a protected
or existing deployment to implement this note.

If prefix-based suffixes are an actual product requirement, retain them only
with an explicit contract and UI model that distinguishes suffix from
resolved URI and handles base changes deliberately. Do not mix this with the
complete-URI invariant or silently strip guessed prefixes in the viewer.

## Evidence before implementation or deployment

- Exercise registration and update with an empty base and verify the exact
  stored argument and returned token URI for HTTPS, IPFS and `data:` values.
- Exercise a nonempty base, the resolved-read/write case, and an authorized
  base change, including an existing token. Establish the observed behavior
  before selecting any mitigation.
- Test registration against the selected collection and updates against the
  recorded collection, including when they differ.
- For any future contract design, test that complete token URIs remain exact
  across relevant administrative changes and that metadata update events and
  existing authorization behavior remain correct.
- For an existing deployment, obtain its actual identity, code and current
  configuration through the authorized release workflow before making any
  deployment-specific claim. No such live verification was performed here.

The separate issue of preserving unrelated JSON fields during NFT metadata
edits is not solved by an empty base; note 041 covers it.
