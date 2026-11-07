# Bike NFT

A serial-numbered component registry backed by ERC-721 ownership. Registrars create records; owners maintain them, grant expiring workshop capabilities and transfer the NFT. Registry records do not prove physical authenticity.

## Guides

- [Use the registry or run a local demo](https://numpde.github.io/dapp32/bike-nft/).
- [Prepare token metadata](https://numpde.github.io/dapp32/bike-nft/metadata.html), including the collection-base URI boundary.
- [Hand over ownership or authorize a workshop](https://numpde.github.io/dapp32/bike-nft/ownership.html).
- [Run the distinct-actor scenario](https://numpde.github.io/dapp32/development/app-checks.html#bike).
- [Deploy and accept authorities](https://numpde.github.io/dapp32/deployment/bike-nft/).

## Source

[Collection](src/BicycleComponents.sol) · [Manager](src/BicycleComponentManager.sol) · [Read projection](src/BicycleComponentManagerUI.sol) · [CAM routes](cam/main.json) · [Screens](cam/ui.json) · [Sample metadata](cam/components/).

The local demo uses public fixture accounts and zero admin delays. It is not a public-network deployment template; use the deployment guide for final authorities and handovers.
