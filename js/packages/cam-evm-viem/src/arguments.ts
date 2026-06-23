import type { AbiFunction, AbiParameter } from "viem"
import {
  createStringMap,
  diffNameSets,
  isAbiAddressValue,
  isAbiBytesValue,
  isAbiIntegerValue,
  isRecordObject,
  inspectAbiParameterNames,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  toInertValue,
} from "@cam/protocol"
import type { AbiIntegerType, AbiParameterNameIssue, InertValue, NamedAbiParameter } from "@cam/protocol"

import {
  dynamicArrayElement,
} from "./abi-values.ts"
import { CamEvmError } from "./errors.ts"

type ArgumentErrorCode = "CAM_ROUTE_INVALID_ARGUMENT" | "CAM_WRITE_INVALID_ARGUMENT"

export function abiFunctionInputs(
  fn: AbiFunction,
  errorCode: ArgumentErrorCode,
): readonly AbiParameter[] {
  if (!Array.isArray(fn.inputs)) {
    throw new CamEvmError(errorCode, `CAM function ABI is missing inputs: ${fn.name}`)
  }

  return fn.inputs
}

export function normalizeAbiArgs({
  inputs,
  args,
  functionName,
  errorCode,
}: {
  readonly inputs: readonly AbiParameter[]
  readonly args: Record<string, InertValue>
  readonly functionName: string
  readonly errorCode: ArgumentErrorCode
}): readonly unknown[] {
  // CAM manifests use named arguments so reviewers can audit intent. EVM calls
  // are positional, so this is the single boundary that checks names and orders
  // them exactly as the ABI requires.
  const namedInputs = requireNamedParameters(inputs, errorCode, functionName, "ABI input")
  const expectedNames = namedInputs.map(({ name }) => name)

  diffNameSets({
    expectedNames,
    actualNames: Object.keys(args),
    onUnexpected: (name) => {
      throw invalidArg(errorCode, functionName, name, "unexpected argument")
    },
    onMissing: (name) => {
      throw invalidArg(errorCode, functionName, name, "missing argument")
    },
  })

  return namedInputs.map(({ parameter, name }) => {
    return normalizeAbiArg(args[name], parameter, `${functionName}.${name}`, errorCode)
  })
}

function normalizeAbiArg(
  value: InertValue,
  parameter: AbiParameter,
  path: string,
  errorCode: ArgumentErrorCode,
): unknown {
  const type = parameter.type

  const element = dynamicArrayElement(parameter)
  if (element !== undefined) {
    if (!Array.isArray(value)) {
      throw invalidArg(errorCode, path, "", `expected array for ${type}`)
    }

    return value.map((item, index) =>
      normalizeAbiArg(item, element, `${path}.${index}`, errorCode),
    )
  }

  if (type === "string") {
    if (typeof value !== "string") throw invalidArg(errorCode, path, "", "expected string")
    return value
  }

  if (type === "address") {
    if (!isAbiAddressValue(value)) throw invalidArg(errorCode, path, "", "expected address")
    return value.toLowerCase()
  }

  if (type === "bool") {
    if (typeof value !== "boolean") throw invalidArg(errorCode, path, "", "expected bool")
    return value
  }

  try {
    const integerType = parseAbiIntegerType(type)
    if (integerType !== undefined) {
      return normalizeInteger(value, errorCode, path, integerType)
    }
  } catch (cause) {
    throw invalidArg(errorCode, path, "", cause instanceof Error ? cause.message : String(cause))
  }

  let fixedBytesLength: number | undefined
  try {
    fixedBytesLength = parseAbiFixedBytesLength(type)
  } catch (cause) {
    throw invalidArg(errorCode, path, "", cause instanceof Error ? cause.message : String(cause))
  }
  if (type === "bytes" || fixedBytesLength !== undefined) {
    if (!isAbiBytesValue(value, fixedBytesLength)) throw invalidArg(errorCode, path, "", `expected hex bytes for ${type}`)
    return value
  }

  if (type === "tuple") {
    if (!isRecordObject(value)) throw invalidArg(errorCode, path, "", "expected object for tuple")
    const components = requireNamedParameters(
      tupleComponents(parameter, errorCode, path),
      errorCode,
      path,
      "tuple component",
    )
    const componentNames = new Set(components.map(({ name }) => name))
    for (const name of Object.keys(value)) {
      if (!componentNames.has(name)) {
        throw invalidArg(errorCode, path, name, "tuple has unexpected component")
      }
    }

    const tuple = createStringMap<unknown>()
    for (const { parameter: component, name } of components) {
      if (!Object.hasOwn(value, name)) {
        throw invalidArg(errorCode, path, name, "tuple is missing component")
      }
      tuple[name] = normalizeAbiArg(
        toInertValue(value[name]),
        component,
        `${path}.${name}`,
        errorCode,
      )
    }
    return tuple
  }

  throw invalidArg(errorCode, path, "", `unsupported ABI input type: ${type}`)
}

function normalizeInteger(value: InertValue, errorCode: ArgumentErrorCode, path: string, type: AbiIntegerType): bigint {
  if (!isAbiIntegerValue(value, type)) throw invalidArg(errorCode, path, "", "expected integer")
  return BigInt(value)
}

function tupleComponents(
  parameter: AbiParameter,
  errorCode: ArgumentErrorCode,
  path: string,
): readonly AbiParameter[] {
  if (!("components" in parameter) || !Array.isArray(parameter.components)) {
    throw invalidArg(errorCode, path, "", "tuple ABI input is missing components")
  }

  return parameter.components
}

function requireNamedParameters(
  parameters: readonly AbiParameter[],
  errorCode: ArgumentErrorCode,
  path: string,
  label: string,
): readonly NamedAbiParameter<AbiParameter>[] {
  const inspected = inspectAbiParameterNames(parameters)
  const issue = inspected.issues[0]
  if (issue !== undefined) {
    throw abiParameterNameError(issue, errorCode, path, label)
  }

  return inspected.entries
}

function abiParameterNameError(
  issue: AbiParameterNameIssue,
  errorCode: ArgumentErrorCode,
  path: string,
  label: string,
): CamEvmError {
  if (issue.kind === "unnamed") {
    return invalidArg(errorCode, path, String(issue.index), `${label} must be named`)
  }

  return invalidArg(errorCode, path, issue.name, `${label} name is duplicated`)
}

function invalidArg(
  code: ArgumentErrorCode,
  path: string,
  name: string,
  message: string,
): CamEvmError {
  const suffix = name === "" ? "" : `.${name}`
  return new CamEvmError(code, `CAM ABI argument ${path}${suffix}: ${message}`)
}
