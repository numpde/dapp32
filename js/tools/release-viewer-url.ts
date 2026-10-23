import { pathToFileURL } from "node:url"
import { requireHttpOrigin, requireHttpURL } from "../packages/cam-protocol/dist/index.js"
import { parseDeploymentArtifact as parseBike } from "./bike-nft-release/shared.ts"
import { parseDeploymentArtifact as parseEscrow } from "./escrow-release/shared.ts"
import { parseDeploymentArtifact as parsePayments } from "./pay-to-play-release/shared.ts"
import { readBoundedRegularFile } from "./release-files.ts"
import { requiredEnv } from "./input.ts"

export function releaseViewerURL(app: string, bytes: Uint8Array, viewerOrigin: string, resourceOrigin: string): string {
  let deployment
  switch (app) {
    case "bike-nft": deployment = parseBike(bytes); break
    case "escrow": deployment = parseEscrow(bytes); break
    case "pay-to-play": deployment = parsePayments(bytes); break
    default: throw new Error("Release viewer app must be bike-nft, escrow or pay-to-play")
  }
  if (deployment.chainId !== 31338) throw new Error("Local release viewer requires a deployment on fixture chain 31338")
  const resources = requireHttpOrigin(resourceOrigin, "release viewer resource origin")
  const cam = requireHttpURL(deployment.camURI, "deployment CAM URI")
  if (cam.protocol !== "https:" || cam.origin !== resources) {
    throw new Error("Deployment CAM must use HTTPS on the explicit viewer resource origin")
  }
  const url = new URL(requireHttpOrigin(viewerOrigin, "release viewer origin"))
  url.search = new URLSearchParams({
    chainId: `eip155:${deployment.chainId}`, host: deployment.camRoot, account: deployment.deployer,
    rpcUrl: new URL("/rpc", url).href,
  }).toString()
  return url.href
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env
  const bytes = await readBoundedRegularFile("/deployment/deployment.json", "deployment artifact", 1024 * 1024)
  console.log(releaseViewerURL(
    requiredEnv(env, "RELEASE_VIEWER_APP"), bytes,
    requiredEnv(env, "RELEASE_VIEWER_ORIGIN"), requiredEnv(env, "RELEASE_VIEWER_RESOURCE_ORIGIN"),
  ))
}
