---
title: "How a dapp32 application runs"
description: "Follow discovery, contract reads, transaction preparation, wallet approval, and execution."
outline: false
---

# How a dapp32 application runs

<div class="ported-guide">

The [homepage](../index.md) describes the business contracts, CAM root, off-chain CAM, and shared viewer. This page follows what happens when someone opens an application and executes an action. The CAM root is an on-chain contract; the CAM files are served separately.

## Opening an application

1. **Select the chain and CAM root address.** Choose a published instance in the [Gallery](../gallery/), or enter the chain and CAM root in a viewer. The viewer uses RPC to query the CAM root contract.
2. **Load the CAM.** The root returns the manifest's URI and byte digest, and resolves named contract addresses. The viewer fetches the manifest from its off-chain location, then fetches its referenced UI, ABI, and protocol resources. These files are not stored in the root contract.
3. **Interpret the workflow.** The CAM defines routes, contract calls, and screens. The standard viewer renders those screens; a compatible agent can interpret the same CAM without a graphical interface. Neither needs a dedicated frontend for this application.
4. **Read state.** Through RPC, the viewer calls the contracts identified by the CAM root. An application may also use an optional read-only UI projection contract to assemble information for a screen. The viewer displays the returned data and available actions.

Opening an app requires a usable RPC endpoint and browser access to the hosted CAM resources. Merely opening or reading it does not require the user to sign a transaction. Choosing a viewing address does not grant authority to act as that address.

## Executing an action

For example, consider depositing money into a Pay-to-Play payment channel:

1. The user enters an amount in the viewer. The form holds a local draft; no transaction has been sent.
2. The CAM route tells the viewer which contract function to call and how to form its arguments and native value. The viewer prepares the transaction and may simulate it.
3. The user reviews the destination, network, arguments, and amount, then authorizes the transaction through a wallet.
4. The business contract executes the call and checks the real sender, supplied value, current state, and its own rules. The CAM and viewer cannot bypass those checks.
5. A successful transaction receipt establishes execution. The viewer rereads the resulting contract state to display the updated balance or status.

Simulation can become stale between preparation and submission. A transaction hash alone is not evidence of successful execution; check the receipt. For a disposable example, use the [local-wallet walkthrough](local-wallet.html).

## What can change independently

- **CAM files:** Changing a screen, label, or workflow description changes the interface without changing the business contracts. The changed resources must be published and referenced by an updated CAM publication.
- **CAM root:** Changing its published manifest reference or named address bindings changes what clients discover; it does not migrate business-contract state.
- **Viewer:** Updating the standard viewer changes the client software, not the published CAM or on-chain contracts.
- **UI projection contract:** An optional read-only contract can assemble state for display. It does not authorize transactions or define the screen layout.

## What publication proves

The current format uses SHA-256 digests of the manifest and referenced resources. Matching digests show that fetched bytes agree with a particular CAM publication; they do not establish that the publisher, contract code, RPC endpoint, or application is trustworthy. Named address bindings can change independently of the manifest.

The viewer can continue after an integrity warning. Treat it as an unresolved warning, not proof that the application is safe. Before signing, verify the selected chain, destination contract, function, arguments, and amount. The [CAM trust-boundary reference](../reference/cam/1.4.0/#security) specifies the exact behavior.

</div>
