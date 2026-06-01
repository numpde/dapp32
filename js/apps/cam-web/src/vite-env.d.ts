/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH?: string
}

interface EthereumProvider {
  request(args: {
    readonly method: string
    readonly params?: readonly unknown[] | object
  }): Promise<unknown>
}

interface Window {
  readonly ethereum?: EthereumProvider
}
