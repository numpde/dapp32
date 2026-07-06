export type AbiDeclarationJsonCase = {
  readonly label: string
  readonly value: unknown
}

export type AbiDeclarationRawCase = {
  readonly label: string
  readonly rawText: string
}

export type AbiDeclarationCase = AbiDeclarationJsonCase | AbiDeclarationRawCase

export const ABI_DECLARATION_ACCEPTED_CASES = [
  {
    label: "valid function with named inputs and unnamed output",
    value: [{
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "string" }],
    }],
  },
  {
    label: "non-function ABI item is not treated as a CAM callable surface",
    value: [
      {
        type: "event",
        name: "Saved",
        inputs: [{ indexed: false, name: "value", type: "uint256[2]" }],
      },
      {
        type: "function",
        name: "viewEntry",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "string" }],
      },
    ],
  },
  {
    label: "payable declaration is accepted before route policy decides usability",
    value: [{
      type: "function",
      name: "pay",
      stateMutability: "payable",
      inputs: [],
      outputs: [],
    }],
  },
  {
    label: "nested dynamic arrays of tuples with named components",
    value: [{
      type: "function",
      name: "viewNested",
      stateMutability: "view",
      inputs: [{
        name: "groups",
        type: "tuple[][]",
        components: [
          { name: "count", type: "uint8" },
          { name: "owner", type: "address" },
        ],
      }],
      outputs: [{
        type: "tuple[][]",
        components: [
          { name: "count", type: "uint8" },
          { name: "owner", type: "address" },
        ],
      }],
    }],
  },
] as const satisfies readonly AbiDeclarationJsonCase[]

export const ABI_DECLARATION_REJECTED_CASES = [
  { label: "ABI resource is not JSON", rawText: "{" },
  { label: "ABI resource is not an array", value: { abi: [] } },
  { label: "ABI item is not an object", value: [null] },
  { label: "ABI item type missing", value: [{ name: "viewEntry" }] },
  { label: "ABI item type empty", value: [{ type: "", name: "viewEntry" }] },
  {
    label: "function name missing",
    value: [{ type: "function", stateMutability: "view", inputs: [], outputs: [] }],
  },
  {
    label: "function name unsupported",
    value: [{ type: "function", name: "view-entry", stateMutability: "view", inputs: [], outputs: [] }],
  },
  {
    label: "stateMutability missing",
    value: [{ type: "function", name: "viewEntry", inputs: [], outputs: [] }],
  },
  {
    label: "stateMutability unsupported",
    value: [{ type: "function", name: "viewEntry", stateMutability: "mutable", inputs: [], outputs: [] }],
  },
  {
    label: "inputs is not an array",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: {}, outputs: [] }],
  },
  {
    label: "outputs is not an array",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [], outputs: {} }],
  },
  {
    label: "input is not an object",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [null], outputs: [] }],
  },
  {
    label: "output is not an object",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [], outputs: [null] }],
  },
  {
    label: "input type missing",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "value" }], outputs: [] }],
  },
  {
    label: "output type missing",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [], outputs: [{}] }],
  },
  {
    label: "unsupported scalar type",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "value", type: "uint257" }], outputs: [] }],
  },
  {
    label: "fixed-size array",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "values", type: "uint256[2]" }], outputs: [] }],
  },
  {
    label: "components on non-tuple type",
    value: [{
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [{ name: "value", type: "uint256", components: [{ name: "inner", type: "uint256" }] }],
      outputs: [],
    }],
  },
  {
    label: "tuple without components",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "value", type: "tuple" }], outputs: [] }],
  },
  {
    label: "tuple component is not an object",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "value", type: "tuple", components: [null] }], outputs: [] }],
  },
  {
    label: "unnamed function input",
    value: [{ type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [] }],
  },
  {
    label: "duplicate function input name",
    value: [{
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [{ name: "value", type: "uint256" }, { name: "value", type: "uint256" }],
      outputs: [],
    }],
  },
  {
    label: "unnamed tuple component",
    value: [{
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [{ name: "value", type: "tuple", components: [{ type: "uint256" }] }],
      outputs: [],
    }],
  },
  {
    label: "duplicate tuple component name",
    value: [{
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [{
        name: "value",
        type: "tuple",
        components: [{ name: "amount", type: "uint256" }, { name: "amount", type: "uint256" }],
      }],
      outputs: [],
    }],
  },
  {
    label: "duplicate function signature",
    value: [
      { type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [] },
      { type: "function", name: "viewEntry", stateMutability: "view", inputs: [{ name: "otherAccount", type: "address" }], outputs: [] },
    ],
  },
] as const satisfies readonly AbiDeclarationCase[]
