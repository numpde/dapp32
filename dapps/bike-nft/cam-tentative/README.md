# Tentative CAM Screen Model

This folder sketches a possible next CAM screen shape. It is intentionally not
wired to the current runtime parser.

The useful idea is a catalog-resolved component tree:

- A screen is a flat component tree.
- Catalogs map semantic IDs to renderable node fragments.
- `Include` expands one or more selected catalog IDs at that point in the tree.
- Contracts return semantic view/action IDs, not CAM file paths.

The catalog roles are deliberately separate:

- `*.views.json` catalogs are mutually exclusive body-state fragments.
- `*.actions.json` catalogs are command affordance fragments.
- `navigation.actions.json` holds reusable route-navigation controls.

The generic primitive is still one node:

```json
{
  "type": "Include",
  "from": "componentActions",
  "select": "$values.0.actions",
  "order": ["updateMetadata", "markMissing", "clearMissing", "retire"]
}
```

`select` may resolve to a string or an array of strings. When `order` is
present, the screen controls arrangement and the selected IDs are treated as an
active set.

The tentative route output shape is deliberately semantic. The contract/view
helper should return IDs such as:

```json
{
  "view": "found",
  "actions": ["updateMetadata", "markMissing"],
  "serialNumber": "DEMO-FRAME-001"
}
```

It should not return catalog resource paths such as:

```json
{
  "parts": ["./catalogs/component.views.json#found"]
}
```

The screen owns placement, the selected catalog owns render fragments, and the
contract owns only semantic state and capabilities.
