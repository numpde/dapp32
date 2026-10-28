/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAM_WEB_RESOURCE_ORIGIN?: string
  readonly VITE_CAM_WEB_BUILD_REVISION?: string
  readonly VITE_CAM_WEB_BUILD_TIME?: string
  readonly VITE_CAM_WEB_BUILD_MODIFIED?: string
}

interface EthereumProvider {
  on?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (value: unknown) => void): void
  removeListener?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (value: unknown) => void): void
  request(args: {
    readonly method: string
    readonly params?: readonly unknown[] | object
  }): Promise<unknown>
}

interface Window {
  readonly ethereum?: EthereumProvider
}
