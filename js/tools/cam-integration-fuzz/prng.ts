export type Prng = {
  readonly integer: (exclusiveMax: number) => number
  readonly pick: <T>(values: readonly T[]) => T
}

export function createPrng(seed: string): Prng {
  let state = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  if (state === 0) state = 1

  function next(): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }

  return {
    integer(exclusiveMax) {
      if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0) {
        throw new Error(`invalid PRNG bound: ${exclusiveMax}`)
      }
      return next() % exclusiveMax
    },
    pick(values) {
      if (values.length === 0) {
        throw new Error("cannot pick from an empty array")
      }
      const value = values[this.integer(values.length)]
      if (value === undefined) {
        throw new Error("internal PRNG pick failed")
      }
      return value
    },
  }
}

