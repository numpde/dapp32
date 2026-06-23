import {
  hasOwn,
  isRecordObject,
  parseJsonText,
  toInertValue,
} from "../packages/cam-protocol/dist/index.js"
import type { InertRecord } from "../packages/cam-protocol/dist/index.js"

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }

  return value
}

export function requiredPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number {
  const value = requiredEnv(env, name)
  return parsePositiveIntegerText(value, `${name}: expected a positive integer`)
}

export function parsePositiveIntegerText(value: string, message: string): number {
  const parsed = Number(value)
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(message)
  }

  return parsed
}

export function requiredBooleanEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = requiredEnv(env, name)
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
}

export function readInertRecordEnv(env: NodeJS.ProcessEnv, name: string): InertRecord {
  const value = toInertValue(parseJsonText(requiredEnv(env, name)))
  if (!isRecordObject(value)) {
    throw new Error(`${name}: expected a JSON object`)
  }

  return value
}

export function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${path}: expected an object`)
  }

  return value
}

export function requiredArray(source: Record<string, unknown>, key: string): readonly unknown[] {
  const value = requiredField(source, key)
  if (!Array.isArray(value)) {
    throw new Error(`${key}: expected an array`)
  }

  return value
}

export function requiredString(source: Record<string, unknown>, key: string, path: string): string {
  return requiredStringValue(requiredField(source, key), path)
}

export function requiredStringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: expected a non-empty string`)
  }

  return value
}

export function requiredBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = requiredField(source, key)
  if (typeof value !== "boolean") {
    throw new Error(`${path}: expected a boolean`)
  }

  return value
}

export function requiredField(source: Record<string, unknown>, key: string): unknown {
  if (!hasOwn(source, key)) {
    throw new Error(`required object field is missing: ${key}`)
  }

  return source[key]
}
