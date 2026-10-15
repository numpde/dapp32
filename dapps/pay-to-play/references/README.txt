Service-payment reference sources
=================================

These snapshots support the planned pay-to-play app. The design record is
../../../notes/020_service_payment_channels.txt. E is its onchain
deposit/settlement contract. A customer funds a dedicated channel with
settlement service Y and signs cumulative payment authorizations offchain.
Y coordinates concurrent purchases from multiple APIs and collects from E at
its fixed recipient A. Different settlement services have separate channel
backing; APIs using the same Y share that channel and trust Y's accounting
and onward payments. API credits are obligations of Y, not claims against E.

The sources below help distinguish the channel contract from Y's shared API
ledger. They do not settle the app's open authorization, concurrency or payout
mechanisms. Paths below are relative to service-payment-channels/, the
snapshot collection beside this README. That directory contains provenance.json
and the five source-family directories.

Suggested reading order
-----------------------

1. AbstractStreamChannel: the closest concrete core to inspect first. It
   supports funding/top-ups, cumulative EIP-712 delta payments and closing.
   Compare its fixed 15-minute grace period and payee identity with E's planned
   per-channel period and separate serviceId/recipient terms.

   abstract-packages/packages/contracts/src/AbstractStreamChannel.sol
   abstract-packages/packages/contracts/src/interfaces/IAbstractStreamChannel.sol

2. x402 batch settlement: read the EVM specification and implementation notes,
   then the matching contract. This provides a modern cumulative-voucher and
   batch-claim comparison. Its maxClaimableAmount is a signed ceiling over
   server-accounted actual charges; this differs from the app's proposed exact
   cumulative amount. Its claim accounting and recipient transfer are separate.

   x402/specs/schemes/batch-settlement/scheme_batch_settlement_evm.md
   x402/contracts/evm/docs/x402-batch-settlement-implementers.md
   x402/contracts/evm/src/x402BatchSettlement.sol
   x402/contracts/evm/src/interfaces/IDepositCollector.sol

3. microRaiden: a historical API/content micropayment design. Deposits,
   cumulative balance proofs and top-ups lead primarily to settlement at
   closure, with cooperative and challenged unilateral closing paths. Read
   for that distinction from periodic collection while a channel stays open.

   microraiden/docs/introduction/introduction.rst
   microraiden/contracts/contracts/RaidenMicroTransferChannels.sol

4. Raiden service payments: raiden-spec describes the shared UserDeposit and
   OneToN model; raiden-contracts contains its concrete contract implementations.
   A shared deposit permits competing service claims, an accepted trade-off
   in that design. Compare this with Y's responsibility for shared API credits;
   E's separate customer/Y channels do not share backing across Y and Yprime.

   raiden-spec/service_contracts.rst
   raiden-contracts/raiden_contracts/data/source/services/UserDeposit.sol
   raiden-contracts/raiden_contracts/data/source/services/OneToN.sol
   raiden-contracts/raiden_contracts/data/source/services/ServiceRegistry.sol

Snapshot boundaries
-------------------

service-payment-channels/provenance.json records immutable repository commits,
retrieval date, exact upstream paths/URLs, byte sizes and SHA-256 hashes.
Upstream files retain their original bytes. Small repository-local imports
accompany the main contracts;
external OpenZeppelin, Solady and forge-std dependencies are not vendored, so
this is not a self-contained compilation tree. No upstream code was executed
to prepare the snapshots.

Repository LICENSE files are retained for microraiden, x402 and raiden-contracts;
x402's NOTICE is retained too. The pinned abstract-packages tree has no root
or contracts-package LICENSE, and raiden-spec has no LICENSE file; those
absences are recorded in provenance.json and source SPDX notices are preserved.
This collection records precedents without selecting a dependency or making
an adoption/security assessment.
