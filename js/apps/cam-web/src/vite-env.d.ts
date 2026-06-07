/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH?: string
  readonly VITE_CAM_WEB_RESOURCE_ORIGIN?: string
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
