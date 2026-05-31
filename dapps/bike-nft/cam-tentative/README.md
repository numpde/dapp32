# Tentative CAM UI Model

This folder sketches a possible next CAM UI shape. It is intentionally not
wired to the current runtime parser.

The useful idea is one app manifest plus one top-level UI node table:

- `main.json` owns namespace declarations and route/write wiring.
- `ui.json` owns named render/action nodes.
- `Include` expands UI nodes through a `call`.
- Contracts return semantic view/action IDs, not CAM file paths.
- Contract calls, route jumps, UI renders, and UI actions all use one call
  shape: namespace, function, and args.

The root/app contract should point to `main.json`. It should not point directly
to `ui.json`, because the viewer still needs namespace declarations and route
wiring before it can execute the entry route.

`main.json` declares every callable namespace:

```json
{
  "namespaces": {
    "contracts.BicycleComponentManagerUI": {
      "type": "contract",
      "abiURI": "./abi/BicycleComponentManagerUI.json"
    },
    "routes": {
      "type": "routes"
    },
    "ui": {
      "type": "ui",
      "uri": "./ui.json"
    }
  }
}
```

The single call shape is:

```json
{
  "namespace": "contracts.BicycleComponentManagerUI",
  "function": "viewEntry",
  "args": {
    "account": "$account.address"
  }
}
```

Routes and UI nodes carry that shape in a `call` field when they perform an
operation.

`namespace` is closed and protocol-owned:

- `type: "contract"` calls an ABI-backed contract.
- `type: "routes"` calls a CAM route declared in `routes`.
- `type: "ui"` calls a named UI node from the declared UI resource.

Namespace declarations use `type` for namespace kind. UI nodes use `tag` for
render element kind.

Read targets pass their outputs into a UI call:

```json
{
  "then": {
    "namespace": "ui",
    "function": "app",
    "args": {
      "account": "$account",
      "form": "$form",
      "input": "$inputs",
      "view": "$outputs.0"
    }
  }
}
```

Write targets can continue into another route with the same shape:

```json
{
  "then": {
    "namespace": "routes",
    "function": "component",
    "args": {
      "serialNumber": "$inputs.serialNumber"
    }
  }
}
```

The generic expansion primitive is one node:

```json
{
  "tag": "Include",
  "call": {
    "namespace": "ui",
    "function": "$view.actions",
    "args": {
      "form": "$form"
    }
  }
}
```

For `Include`, `call.function` controls which top-level UI node IDs appear. If
it resolves to an array, that array is presentation order. For action nodes,
the contract/view helper returns only currently valid actions. `call.args` is
the complete context passed to each expanded node.

Named UI nodes declare the argument names they expect:

```json
{
  "app": {
    "tag": "Screen",
    "requires": ["account", "form", "input", "view"]
  }
}
```

`requires` lists the context names a node reads directly, including values it
forwards through `Include.call.args`. Expanded nodes must be satisfied only by
the context their parent explicitly forwards.

The root app shell is just another named UI node:

```json
{
  "app": {
    "tag": "Screen",
    "children": [
      {
        "tag": "Include",
        "call": {
          "namespace": "ui",
          "function": "$view.view",
          "args": {
            "account": "$account",
            "input": "$input",
            "view": "$view"
          }
        }
      }
    ]
  }
}
```

Action nodes start routes. They do not name contracts directly:

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

The target route in `main.json` declares its named `inputs`, its contract call,
and any follow-up route. Contract-call `args` are named by ABI input name, not
by position:

```json
{
  "call": {
    "namespace": "contracts.BicycleComponentManager",
    "function": "registerComponent",
    "args": {
      "owner": "$account.address",
      "serialNumber": "$inputs.serialNumber",
      "tokenURI_": "$inputs.tokenURI"
    }
  }
}
```

The ABI decides whether the call is a read or a write. `ui.json` does not
duplicate function mutability and does not contain nested post-success actions.

The tentative route output shape is deliberately semantic. The contract/view
helper should return IDs such as:

```json
{
  "view": "component.found",
  "actions": ["updateMetadata", "markMissing"],
  "serialNumber": "DEMO-FRAME-001"
}
```

It should not return resource paths or node pointers such as:

```json
{
  "parts": ["./ui.json#component.found"]
}
```

The UI owns placement and node definitions. The contract owns only semantic
state and capabilities.
