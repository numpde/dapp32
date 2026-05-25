declare module "node:fs/promises" {
  export function readFile(path: URL | string, encoding: "utf8"): Promise<string>
  export function readFile(path: URL | string): Promise<Uint8Array>
}

declare module "node:process" {
  export const stdin: {
    readonly isTTY?: boolean
  }
  export const stdout: {
    write(chunk: string): boolean
  }
}

declare module "node:readline/promises" {
  import type {
    stdin,
    stdout,
  } from "node:process"

  export type Interface = AsyncIterable<string> & {
    close(): void
    prompt(): void
  }

  export function createInterface(options: {
    readonly input: typeof stdin
    readonly output: typeof stdout
    readonly prompt: string
  }): Interface
}

declare module "node:url" {
  export function fileURLToPath(url: URL | string): string
}

declare const process: {
  exitCode?: number
}
