import catalog from "./ipfs-gateways.json" with { type: "json" }

export const publicIpfsGateways = Object.entries(catalog.gateways)
  .filter(([, gateway]) => gateway.responseFormat === "file"
    && !/[{}]/u.test(gateway.urlTemplate.replace("{CID}", "cid").replace("{PATH}", "path")))
  .map(([id, gateway]) => ({ id, name: gateway.name, template: gateway.urlTemplate }))

export const defaultIpfsGateway = publicIpfsGateways[0]!
