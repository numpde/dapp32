# CAM UI Model

This folder contains the current CAM resources for the bike NFT example.

The root contract points to `main.json`, not directly to `ui.json`. The
manifest declares how to call contracts, routes, and UI nodes before the viewer
can execute the entry route.

## Shape

`main.json` owns callable namespaces and routes. `ui.json` owns named render and
action nodes.

Every operation uses the same call shape:

```json
{
  "namespace": "contracts.BicycleComponentManagerUI",
  "function": "viewEntry",
  "args": {
    "account": "$account.address"
  }
}
```

Routes and actionable UI nodes carry that object in `call`. Route continuations
carry the same object in `then`.

Namespaces are closed and declared in `main.json`:

- `type: "contract"` calls an ABI-backed contract.
- `type: "routes"` calls a route in `routes`.
- `type: "ui"` calls a named UI node from the UI resource.

Namespace declarations use `type` for namespace kind. UI nodes use `tag` for
render element kind.

## UI Nodes

Named UI nodes declare the arguments they read:

```json
{
  "app": {
    "tag": "Screen",
    "requires": ["view"]
  }
}
```

`requires` covers direct reads, including values forwarded to children.
Expanded nodes receive only the args their parent passes.

Input `props.value` initializes `form[input.name]`; after that, the viewer owns
the current form value and actions read it through the runtime `form` root.

`Include` is the expansion primitive:

```json
{
  "tag": "Include",
  "call": {
    "namespace": "ui",
    "function": "$view.actions",
    "args": {}
  }
}
```

For `Include`, `call.function` selects one UI node ID or an ordered array of UI
node IDs. Action nodes in that selected list are assumed to already be valid;
the contract/view helper does not return disabled actions.

Action nodes call routes, not contracts:

```json
{
  "tag": "Action",
  "props": {
    "label": "Prepare registration"
  },
  "call": {
    "namespace": "routes",
    "function": "registerComponent",
    "args": {
      "serialNumber": "$form.serialNumber",
      "tokenURI": "$form.tokenURI"
    }
  }
}
```

## Boundary

Contracts return semantic state, view IDs, and valid action IDs:

```json
{
  "viewId": "component.found",
  "actions": ["updateComponentMetadata", "markComponentMissing"],
  "account": "0x...",
  "serialNumber": "DEMO-FRAME-001",
  "tokenURI": "fixture://bike-nft/components/demo-frame-001.json"
}
```

Contracts should not return UI resource paths or fragment references:

```json
{
  "parts": ["./ui.json#component.found"]
}
```

The contract owns business state and capabilities. The manifest owns placement,
node definitions, and route wiring.
