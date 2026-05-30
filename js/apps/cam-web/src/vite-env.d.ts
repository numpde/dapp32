/// <reference types="vite/client" />

interface EthereumProvider {
  request(args: {
    readonly method: string
    readonly params?: readonly unknown[] | object
  }): Promise<unknown>
}

interface Window {
  readonly ethereum?: EthereumProvider
}
