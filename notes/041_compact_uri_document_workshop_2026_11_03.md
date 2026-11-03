# Compact URI and embedded-document workshop

Date: 2026-11-03

Status: design workshop, not an implemented feature or a protocol change.
This develops item 1 of `notes/034_shared_cam_ui_backlog.txt`. Source inventory
is from this checkout; no browser walkthrough or deployment was performed.

## Goal and boundary

A user should be able to enter a document location or write a short text or
JSON document and use its content as a `data:` URI. A recorded location should
be inspectable and copyable, and supported content should be openable or
viewable deliberately. The normal form should remain compact. A URI and a
SHA-256 digest are different facts; neither displaying nor opening a URI proves
that the bytes match a recorded digest.

The editable value is the exact URI string that an action will consume. The
contract remains the authority for its own input and business constraints. The
manifest describes the field and any known applicable limits, the shared viewer
owns interaction and safe resource actions, and the resource loader owns
admission, bounds, cancellation and retrieval. The wallet still owns signing.
Nothing about this design submits a transaction or grants network access.

## Inventory: where it belongs

| Location | Current behavior | Proposed treatment |
| --- | --- | --- |
| Escrow create: `termsUri` | `TextField`, separate `DocumentHashField`; `viewCreateAgreement` exposes the contract's URI byte limit. | First input adoption: shared document URI editor, retaining the separate digest. |
| Escrow agreement actions: `submissionUri`, `disputeUri` | Two `TextField`s and separate digest editors; their displayed 512-byte limit is literal copy. | Same editor and byte rule. The agreement view currently does **not** expose `maxDocumentUriBytes`; make the limit available from the contract-owned source before declaring it here, or keep the limit advisory until then. Do not copy 512 into a new shared policy. |
| Escrow agreement details: terms, submission and dispute URIs | `Status` rows next to recorded digest rows; empty evidence URI has a domain-specific meaning. | URI presentation with exact copy and deliberate view/open; preserve the empty-state meaning and digest as a separate fact. A later explicit verify action compares decoded/retrieved bytes with the recorded digest. |
| Escrow transaction review: creation terms; submit/dispute document | Authored `Status` rows show the URI and digest. Exact prepared arguments and calldata are also available. | Use the same safe URI presentation in review without concealing or changing the exact prepared value. Opening or previewing must not prepare, refresh or submit a transaction. |
| Bike registration and metadata update | Existing `NftMetadataField` chooses hosted JSON or embedded JSON and offers structured name/description/image editing and preview. | Keep the NFT-specific editor and its object/image rules. Investigate reuse of a small, bounded data-URI byte codec and a shared URI presentation; do not replace the NFT workflow with a generic text editor by assumption. |
| Bike `Nft` preview and registration/update review | Preview exposes metadata URI and explicit load; registration review has a metadata `Status`; update review includes the submitted content. | Reuse safe URI display where the value is actually metadata URI. Preserve existing explicit preview, download admission, image-type/size rules and the exact review value. |
| Bike public profile, missing report and resolution | UI explicitly permits prose **or** a link, despite Solidity names containing `URI`. | Keep text fields and ordinary text displays. Do not infer link semantics from ABI names or turn arbitrary content into links. |
| Pay-to-Play | The current app UI has no comparable document-location editor; invoice information is a hash and external signing workflow. | No forced adoption. Revisit only when an actual URI-valued field is introduced. |
| Viewer setup, RPC/gateway addresses, CAM manifest/ABI/UI URLs, explorer links | Distinct network, boot, publication or navigation boundaries with their own policies. CAM resource admission explicitly rejects `data:`. | Out of scope for the document editor. Reuse existing policy owners; do not broaden allowed transports or assume document URI semantics. |

Inventory evidence: `dapps/escrow/cam/ui.json` (`escrow.create`,
`agreement.common`, `agreement.actions`, `escrow.create.review`,
`escrow.agreement.document.review`); `dapps/escrow/src/CamEscrow.sol` and
`CamEscrowUI.sol`; `dapps/bike-nft/cam/ui.json`; `js/apps/cam-web/src/`
`nft-components.tsx`, `nft-metadata.ts`, `prepared-call.ts`, and
`document-hash.ts`. The source name `resolutionURI` is not evidence that its
user-facing text-or-link input is a URI-only field.
The Bike update review currently shares `component.review.text` with missing
and resolution reviews. A URI-specific presentation cannot replace that
shared node wholesale: only the metadata route is URI-only. Introduce a
separate URI-specific composition at that actual handoff if adoption warrants
it, leaving prose reviews as text.

## Workshop round 1: the visible interaction

Initial proposal: a single-line URI field with an **Embed** action, opening a
text/JSON editor in a dialog. Rejected: an ordinary single-line editable input
is poor at displaying a long encoded document, and simply opening a `data:` URI
in a browser tab is unreliable. An icon-only action needs an accessible name
and tooltip to explain what it does.

Revised candidate:

```text
Terms URI
┌────────────────────────────────────────────┐
│ https://…                                  │
└────────────────────────────────────────────┘
  [Embed document]
```

The implemented action uses a document icon within the field, following the
existing joined address control; its accessible name and tooltip identify the
embed or edit action. The action may be placed inline with the field, and
wrap without overlap at narrow widths. It is a secondary action with a clear
name, not a second primary button. For an embedded URI, offer **Edit document**
and retain an inspect/copy affordance for the exact URI; a compact summary is
acceptable only if the whole value remains selectable/copyable and an ordinary
URI can still be entered. Do not use a visual truncation technique that changes
clipboard text or exposes concatenated short and full values to accessibility.
Use a text input rather than assuming HTML `type=url` recognizes the app's
`ipfs:` and `data:` forms. Editing a raw URI and opening the embedded editor
are two views of one bound value, not independent sources that can race.

The dialog contains a clearly named plain-text/JSON choice, a multiline editor,
and **Cancel** / **Use document**. Its exact layout, including whether actions
fit inside the field row, is a rendered design question, not settled by this
ASCII sketch. Open and close restore focus correctly; Escape cancels; tab order
stays inside the modal. Editing a temporary draft must not mutate the bound URI
until **Use document**. A failed or cancelled edit preserves the prior URI.
If the field's value, view, enabled state or active account changes while the
dialog is open, a stale draft must not overwrite the new state. Do not discard
the draft silently: make the conflict recoverable or close it with an explicit,
accessible explanation. Decide the exact interaction in the prototype.

For external locations, opening and fetching are separate effects. Offer an
explicit action only for a recognized supported scheme; retain the literal value
when unsupported. Apply the current download scope to the logical remote URI
before offering or activating an external navigation, and use the selected
gateway for supported IPFS links. Browser navigation has its own redirect and
response behavior, so this admission does not prove the final destination or
bytes were checked. Fetching inside the viewer must use the existing download
scope, gateway, redirects, limits and timeout. No automatic fetch on field edit.
For embedded `text/plain` and
JSON, view decoded content as inert text or structured JSON, not active HTML.
For malformed, unsupported, non-UTF-8 or non-text data URIs preserve and show
the exact value; do not silently reinterpret, replace or execute it.

Feedback: do not add conditional commentary or transient status labels beside
the input. Controls own their pending state. A visible invalid indication must
have an actionable, programmatically associated explanation available to all
users, not just a color or a screen-reader-only message. The exact error-detail
interaction must be demonstrated at keyboard, touch and narrow widths; a
hover-only tooltip is insufficient. Do not disable the only control that
explains why it is disabled. A URI's syntax does not prove reachability,
authority, safety or a digest match.

## Workshop round 2: which bytes and whose limit?

Initial proposal: preserve the exact pasted UTF-8 bytes. Rejected: a text editor
receives characters and HTML `textarea` normalizes line endings; CRLF pasted or
loaded into it is not an exact-byte source. The truthful rule is: encode the
UTF-8 bytes of the current editor value; do not claim those bytes equal the
source file or clipboard bytes. A separate future file import can preserve
exact file bytes without passing through an editable text area. Invalid Unicode
such as unpaired surrogates must be rejected explicitly rather than silently
replaced during UTF-8 encoding.

Plain text and JSON use explicit `text/plain;charset=utf-8` and
`application/json` media types. JSON validation does not reserialize, reorder,
pretty-print, normalize Unicode or change the editor's text. A generic document
editor should not inherit the NFT parser's object-only and duplicate-key
policy accidentally. Decide the generic JSON validation profile explicitly;
rejecting duplicate keys is a defensible interoperability policy but is stricter
than JSON syntax. Validation must not alter numeric values by parsing and
serializing them. No automatic canonicalization.

A `data:` URI can use percent encoding or standard Base64. Recommend a
deterministic encoding rule, while accepting both forms for
safe display/edit when supported; do not switch encodings merely because a URI
was opened. Base64 is already used by the NFT metadata encoder and gives a
predictable bound, but may be longer than percent encoding for plain ASCII.
Local sizing examples with `data:application/json,` and percent-encoded
reserved bytes: 12 ASCII bytes gave a 38-byte URI versus 45 with Base64; a
46-byte JSON example gave 98 versus 93; 40 UTF-8 bytes of Greek text gave 142
versus 85. With the 29-byte `data:application/json;base64,` prefix, an Escrow
URI can contain at most 360 decoded bytes before exceeding 512 bytes. These are
encoding examples, not a promise that the document is valid JSON or fits every
consumer. Prefer a deterministic rule that picks the shorter complete URI, with
a documented tie-breaker, if both representations pass the same decoder and
consumer tests. If interoperability tests favor a fixed encoding, choose it
explicitly and show the real size instead. Do not let the user unknowingly lose
an otherwise valid document merely because the viewer selected a longer
encoding.

Keep the exact
original URI, including encoding, media-type spelling and parameters, until the
user actually applies an edit. Merely opening and cancelling, or opening and
applying an unchanged draft, must not change the URI or bytes; this also avoids
accidental CRLF normalization on a no-op. Unknown parameters, unsupported
charsets and malformed encodings require an honest read-only/unsupported path,
not a lossy round trip.

Escrow's `CamEscrow._validateDocument` checks `bytes(document.uri).length` is
1..512, and requires a nonzero digest. This is the UTF-8 byte length of the
**complete encoded URI**, including `data:` and media-type/encoding prefix,
not the decoded document size or JavaScript character count. `viewCreateAgreement`
exposes the constant; `viewAgreement` does not. The user needs the applicable
encoded-size count and limit before applying the draft. When a limit is not
supplied, enforce an independently documented finite editor/decoder bound but
do not imply it is a contract limit. The current NFT editor has a 256 KiB
metadata limit and its own structured policy; do not promote that limit to a
universal document law. Count before constructing huge encoded copies, bound
both encoded input and decoded output, and keep the input responsive.

Embedding a URI means the document itself becomes part of the transaction
argument and potentially public contract data; the exact storage consequences
depend on the contract. The editor displays encoded bytes and the applicable
limit as a compact counter within the document control, including an over-limit
indication. Do not hardcode gas or estimate fees from byte count: the network,
transaction and contract determine them. Transaction review remains the place
to inspect the actual prepared operation and estimation.

Hash integration is not optional for Escrow: `document-hash.ts` currently
accepts HTTP(S)/IPFS URLs, not `data:`. Add an explicit **calculate from
embedded document** path that hashes exactly the decoded bytes of the current
URI and records that source truthfully. Never hash the textual `data:` URI.
Changing the source must retire in-flight and stale success feedback; an older
completion must not overwrite newer input. Existing manual digests must not be
silently erased or silently asserted to match. A separate explicit verification
may compare a digest to fetched/decoded bytes, and must distinguish match,
mismatch, unavailable and unverified. SHA-256 equality says bytes match, not
that the contents or counterparty are trustworthy.

## Workshop round 3: shared model and evolution

Option A: a new all-in-one document widget combining location, content, hash,
verification and contract rules. Rejected: not every URI has a digest, a digest
can be entered independently, and contracts and loaders have different
constraints. It would duplicate authority and couple unrelated actions.

Option B: infer URI semantics from field names, Solidity ABI strings or a
`data:` prefix. Rejected: Bike has prose-or-link strings, and an arbitrary
untrusted string does not grant navigation or loading authority.

Option C, preferred for a prototype: express URI meaning explicitly in CAM
using the existing field/display model, with one generic string binding and an
optional known URI-byte limit; use a shared viewer interaction for embedded
text/JSON and safe URI presentation. Investigate `TextField`/`Status` URI
formats against an explicit `UriField`/`Uri` pair before selecting the public
schema. A format is smaller if it can truthfully express actions and limits;
a dedicated element is justified only if the existing shape cannot express
those semantics without ambiguity. Do not create both overlapping forms or
specify new properties speculatively.

This was a protocol-facing decision: UI elements and props are closed, and
at the time `TextField.format` accepted only `address`. A new format or element
requires deliberate UI specification/version/compatibility decisions, strict
parser and resolved types, state initialization and agent behavior, conformance
checks, all supported renderers, examples and tests, and coherent manifest
integrity refresh. Check older-viewer failure and publication/deployment
compatibility before adoption. A renderer-only URI guess is not an acceptable
substitute. Resource URL admission and contract URI acceptance are different
policies; an unsupported open/preview action must not silently rewrite a string
that the receiving contract otherwise accepts.

Implementation decision: UI 1.0.0 includes dedicated `UriField` and `Uri`
elements. Older viewers reject elements they do not recognize.
Escrow terms is the first authored adoption. This is a local source change,
not evidence that any existing published viewer or deployment was upgraded.

Before choosing hard validation, resolve a concrete compatibility issue:
Escrow's contract accepts any nonempty URI string within the byte limit, even
if the viewer cannot parse or open it. Rejecting unknown schemes, relative
locations or malformed input at the field could block previously valid
on-chain actions. Classify syntax and supported actions independently of the
contract's acceptance; choose any narrower author-declared input policy
deliberately, with a migration path and existing-value tests. A manifest's
claimed limit is untrusted UI guidance, not proof of a contract rule; validate
its type and bound it independently of local decoder/editor resource limits.

Do not promise that all `data:` URIs are editable. At minimum support the
explicit generated text and JSON forms plus bounded, valid UTF-8 percent/base64
variants with understood parameters. Preserve all other inputs exactly and
explain why their content cannot be edited. Shared low-level codec work is
warranted only if it preserves both generic document bytes and NFT policy;
NFT's present encoder does `JSON.stringify` on a parsed metadata object after
edits. Do not describe that as byte-preserving or change it incidentally.

## Workshop round 4: nested NFT image URI

Independent UX, byte-boundary and architecture review changed the earlier
proposal. The current concrete nested case is the NFT metadata object's
top-level `image` string; it is not another CAM field. `NftMetadataField`
binds the **outer** token URI, and its editor owns the containing metadata
draft. Use a shared controlled URI interaction inside that editor if the
semantics fit, but do not create an independent `$state.image` authority or
recursively guess that arbitrary strings or extension fields are URIs.

```text
Token URI
  -> metadata document (hosted or embedded JSON)
       -> image (hosted URI or embedded image bytes)
```

For embedded metadata, choosing a new image must update only the `image` value
in the metadata draft and then derive one outer token URI. A nested dialog's
Cancel must not change the draft; Apply must reject a stale selection if the
parent JSON, source tab, route or account has changed. The existing NFT editor
currently updates its outer binding as the structured or advanced JSON draft
changes, and exposes `null` while invalid. A staged shared dialog therefore
cannot simply be substituted without specifying this state handoff. Preserve
the existing NFT name, description, attributes, extension fields and image
preview; do not replace that editor with a generic document dialog.

Hosted metadata is a reference, not a document this viewer can write. Entering
an image URI while viewing a hosted document cannot silently update the hosted
JSON. Loading a hosted document and creating a modified embedded copy would be
a distinct, explicit action if later selected; it must respect download
admission and must not imply that the original URL was updated. Relative
image paths may resolve against hosted HTTP(S)/IPFS metadata under existing
rules; embedded metadata has no such external base, so the current editor
rejects relative image paths there. Keep those cases distinct.

Image-file embedding is a **separate binary capability**, not something the
text/JSON conversion control automatically supplies. Decide whether it belongs
in the first feature slice rather than assuming it does. If implemented, an
explicit file choice must preserve the selected bytes, never upload or silently
resize/recompress them, and admit the NFT consumer's supported image types.
File type/size admission and browser image decode success are different facts.
Bound the read before encoding, and prevent an old selection or completed read
from replacing a newer draft. Embedded images may be previewed locally without
a network request; external draft images retain their existing explicit load
action. The separate existing NFT preview can load a selected metadata
document and then its image under its current download policy; do not claim
that all image preview is manual.

The limits compose. The NFT viewer's 4 MiB decoded-image limit is not a
permitted image-file size for an embedded metadata document. The enclosing
JSON has a 256 KiB UTF-8 limit, including the inner image URI and all other
fields. With only `{"image":"data:image/png;base64,..."}`, at most 196,581
image bytes fit that JSON bound; the resulting outer Base64 URI is 349,553
bytes. Actual metadata reduces this allowance, and chain, transaction, wallet
or contract limits and costs can be more restrictive. Two Base64 encodings
approach 16/9 of the original image size before prefixes and other JSON.
Calculate from the actual complete candidate before committing it; do not
advertise 4 MiB or the theoretical example as a safe transaction size. These
are viewer bounds, not a proven limit on deployed contracts.

Two existing boundaries block a claim that nested edits are safe:

1. At the time of this workshop, `parseNftMetadata` used `JSON.parse`, and a
   structured edit serialized the
   entire parsed object. For example, an untouched extension value
   `9007199254740993` can become `9007199254740992` when only `image` is
   changed. Existing extension-field tests do not prove arbitrary number or
   byte preservation. Before adding nested editing, select and prove an
   honest strategy: a lossless targeted update of the original JSON, a
   sufficiently strict refusal of inputs that cannot be preserved, or another
   explicit, reviewable decision. A warning alone does not make silent data
   alteration acceptable. Avoid inventing a general JSON editing framework
   before comparing the smallest viable alternatives. No-op and cancel must
   preserve the original URI exactly.
   Follow-up: the NFT editor now refuses structured edits unless its current
   parse-and-serialize path can prove that the original JSON tokens are
   unchanged; direct JSON editing encodes the entered text without
   reserialization. This deliberately rejects some safe-to-edit documents
   with different number or escape spellings. The mutable base issue below
   remains separate.
2. Bike's `BicycleComponents` uses OpenZeppelin `ERC721URIStorage`, whose
   `tokenURI` concatenates any nonempty collection base with the stored URI
   suffix. `baseURI()` is configurable and mutable. Consequently a submitted
   `data:` URI, or any absolute URI, is not necessarily the URI returned by
   `tokenURI`: with a nonempty base it can become `base + data:...`. Moreover,
   the Bike view reads the resolved `tokenURI`, while an update stores its
   supplied argument as a suffix, so resubmitting a resolved URI can prefix it
   twice. The local fixture uses an empty base; that is not evidence about any
   other deployment. Registration uses the manager's current component
   collection, whereas updates use the registered component's token contract.
   Reproduce both against a nonempty base and decide the contract/interface
   semantics separately. A frontend snapshot cannot guarantee a mutable base
   stays unchanged until the transaction executes; a later `tokenURI` read
   establishes only the post-transaction result. Do not present embedded
   metadata as reliably self-contained across configurations before this is
   resolved. Do not change a deployed contract as a side effect of this work.

Nested-URI proof needs exact no-op and cancel, image-only edits retaining
unrelated metadata including large/exponent numbers, relative versus absolute
locations, local-versus-network preview, file boundary and invalid image cases,
both size layers, stale async completion, and nonempty/mutating base URI cases.
Compare the actual prepared and returned URI; a successful transaction alone
does not prove the token metadata resolves.

## Candidate slices and evidence

1. Prototype the URI input and embedded-document dialog against Escrow terms,
   including exact encoded-size accounting and no-op/cancel behavior. Settle
   the URI schema and old-viewer failure behavior first; do not publish an
   incompatible manifest before the viewer and protocol are ready.
2. Add the bounded data-URI decoder/encoder and explicit digest calculation.
   Prove byte equality, source-change invalidation and stale-completion handling.
   Determine how agreement views obtain the contract-owned limit before adopting
   submission and dispute fields.
3. Apply URI display to recorded Escrow documents and relevant reviews. Prove
   empty, malformed and unsupported values remain inspectable; verify retrieval
   only on request under the existing policy. Keep a separate verify action and
   mismatch result if verification is implemented.
4. Review the NFT editor and preview as a separate consumer. Reuse only the
   codec/presentation semantics that genuinely match; retain structured editor,
   external-image and extension-field behavior. Pay-to-Play has no adoption in
   current scope.

Evidence before declaring completion: parse/typeflow/conformance tests for the
chosen public schema; exact encoded/decoded bytes including Unicode, CRLF,
percent encoding, Base64, empty content, unsupported charset, invalid data,
size boundary and one-over; JSON syntax and precision cases; no-op/cancel and
stale-dialog cases; digest/source races and unchanged manual digest; exact URI
copy and review value; explicit fetch admission, denial, timeout and CORS;
keyboard focus/Escape, accessible errors, normal and increased text size, and
1280/761/320 rendered layouts. Test source checks cannot prove all UI states;
exercise actual browser interactions. Verify NFT and Escrow consumers at their
real boundaries, including the actual contract-owned 512-byte limit. No live
transaction is required merely to verify editing and review.

## Sources

- `docs/reference/cam/1.3.0/index.html`: current closed UI elements, resource
  admission, state, NFT editor and digest behavior.
- RFC 2397, data URL syntax: https://datatracker.ietf.org/doc/html/rfc2397
- RFC 8259, JSON and UTF-8: https://www.rfc-editor.org/rfc/rfc8259
- HTML textarea API value and newline normalization:
  https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element
- WAI modal dialog pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG error identification: https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
- Browser `data:` URL navigation limitations:
  https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data
- EIP-7623, chain-specific calldata pricing:
  https://eips.ethereum.org/EIPS/eip-7623
