# Tentative CAM UI Model

This folder sketches a possible next CAM UI shape. It is intentionally not
wired to the current runtime parser.

The useful idea is one app manifest plus one catalog-resolved UI tree:

- `main.json` owns route wiring, ABI resources, and the UI resource.
- `ui.json` owns the presentation tree and inline view/action catalogs.
- `Include` expands selected catalog IDs at that point in the tree.
- Contracts return semantic view/action IDs, not CAM file paths.

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

The generic primitive is one node:

```json
{
  "type": "Include",
  "from": "actions",
  "select": "$values.0.actions",
  "enabled": "$values.0.enabledActions"
}
```

`select` controls which catalog entries appear. `enabled` controls which of
those entries are actionable. Catalog member order is presentation order in this
tentative shape.

The UI title lives in the `Screen` node, not as a second top-level field. The
tree is the presentation source of truth.

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

It should not return catalog resource paths such as:

```json
{
  "parts": ["./ui.json#catalogs.views.component.found"]
}
```

The UI owns placement and render fragments. The contract owns only semantic
state and capabilities.
