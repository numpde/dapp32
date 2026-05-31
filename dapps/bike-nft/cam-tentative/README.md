# Tentative CAM UI Model

This folder sketches a possible next CAM UI shape. It is intentionally not
wired to the current runtime parser.

The useful idea is one app manifest plus one top-level UI node table:

- `main.json` owns route/write wiring, ABI resources, and the UI resource.
- `ui.json` owns named render/action nodes.
- `Include` expands selected top-level node IDs at that point in the tree.
- Contracts return semantic view/action IDs, not CAM file paths.
- UI actions all have the same shape: label, target, and inputs.

The root/app contract should point to `main.json`. It should not point directly
to `ui.json`, because the viewer still needs route wiring and ABI resources
before it can execute the entry route.

`main.json` names the single UI resource:

```json
{
  "resources": {
    "ui": "./ui.json"
  }
}
```

Read targets explicitly pass their outputs into a render continuation:

```json
{
  "then": {
    "render": "ui",
    "select": "app",
    "with": {
      "account": "$account",
      "form": "$form",
      "input": "$inputs",
      "view": "$outputs.0"
    }
  }
}
```

The generic expansion primitive is one node:

```json
{
  "type": "Include",
  "select": "$view.actions",
  "enabled": "$view.enabledActions"
}
```

`select` controls which top-level UI node IDs appear. `enabled` controls which
of those nodes are actionable. Top-level member order is presentation order in
this tentative shape.

Named UI nodes declare the render context names they expect:

```json
{
  "app": {
    "type": "Screen",
    "requires": ["view"]
  }
}
```

`requires` lists only the context names a node reads directly. Dynamic
descendants declare their own requirements.

The root app shell is just another named UI node:

```json
{
  "app": {
    "type": "Screen",
    "children": []
  }
}
```

Action nodes do not name contracts or functions:

```json
{
  "type": "Action",
  "props": {
    "label": "Prepare registration",
    "to": "registerComponent",
    "inputs": {
      "serialNumber": "$form.serialNumber",
      "tokenURI": "$form.tokenURI"
    }
  }
}
```

The target route in `main.json` declares its named `inputs`, its first contract
call, and any follow-up route. The ABI decides whether the first call is a read
or a write; `ui.json` does not duplicate function mutability and does not
contain nested post-success actions.

The tentative route output shape is deliberately semantic. The contract/view
helper should return IDs such as:

```json
{
  "view": "component.found",
  "actions": ["updateMetadata", "markMissing"],
  "enabledActions": ["markMissing"],
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
