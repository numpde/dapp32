import { CamError } from "./errors.ts"

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/
const HIERARCHICAL_URI_RE = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)([?#].*)?$/

export function resolveResourceURI(baseURI: string, resourceURI: string): string {
  assertURIString(baseURI, "baseURI")
  assertURIString(resourceURI, "resourceURI")

  // Absolute references are already resolved. CAM document parsing decides
  // which resource references may appear in protocol declarations.
  if (SCHEME_RE.test(resourceURI)) {
    return resourceURI
  }

  if (resourceURI.startsWith("//")) {
    throw new CamError("CAM_INVALID_URI", "scheme-relative resource URIs are not allowed", "resourceURI")
  }

  const baseWithoutFragment = stripFragment(baseURI)
  if (resourceURI.startsWith("#")) {
    // Fragment-only references intentionally stay within the current resource.
    return `${baseWithoutFragment}${resourceURI}`
  }

  const baseWithoutQuery = stripQuery(baseWithoutFragment)
  if (resourceURI.startsWith("?")) {
    // Query-only references intentionally stay within the current resource.
    return `${baseWithoutQuery}${resourceURI}`
  }

  const [resourcePath, resourceSuffix] = splitSuffix(resourceURI)
  const hierarchical = HIERARCHICAL_URI_RE.exec(baseWithoutQuery)
  if (hierarchical !== null) {
    const [, prefix, basePath] = hierarchical
    const baseDirectory = directoryOf(hierarchicalBasePath(basePath))
    const resolvedPath = normalizePath(resourcePath.startsWith("/") ? resourcePath : `${baseDirectory}${resourcePath}`)
    return `${prefix}${resolvedPath}${resourceSuffix}`
  }

  if (SCHEME_RE.test(baseURI)) {
    throw new CamError("CAM_INVALID_URI", "base URI must be hierarchical to resolve relative resources", "baseURI")
  }

  const baseDirectory = directoryOf(baseWithoutQuery)
  const resolvedPath = normalizeRelativePath(
    resourcePath.startsWith("/") ? resourcePath : `${baseDirectory}${resourcePath}`,
    baseWithoutQuery,
  )
  return `${resolvedPath}${resourceSuffix}`
}

function assertURIString(value: string, path: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new CamError("CAM_INVALID_URI", "expected a non-empty URI string", path)
  }
}

function stripFragment(uri: string): string {
  return uri.split("#", 1)[0]
}

function stripQuery(uri: string): string {
  return uri.split("?", 1)[0]
}

function splitSuffix(uri: string): [string, string] {
  // Keep query/fragment text attached while resolving only the path prefix.
  const queryIndex = uri.indexOf("?")
  const fragmentIndex = uri.indexOf("#")
  const suffixIndex = [queryIndex, fragmentIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]

  if (suffixIndex === undefined) {
    return [uri, ""]
  }

  return [uri.slice(0, suffixIndex), uri.slice(suffixIndex)]
}

function hierarchicalBasePath(basePath: string): string {
  if (basePath === "") {
    return "/"
  }

  return basePath
}

function directoryOf(path: string): string {
  // URI resolution is relative to the containing resource, not the full file
  // path. A base ending in "/" already names a directory-like resource.
  if (path.length === 0 || path.endsWith("/")) {
    return path
  }

  const index = path.lastIndexOf("/")
  if (index < 0) {
    return ""
  }

  return path.slice(0, index + 1)
}

function normalizeRelativePath(path: string, basePath: string): string {
  const normalized = normalizePath(path)
  // Preserve "./" for local file-style bases so examples and tests stay
  // visibly relative instead of becoming bare paths.
  if (basePath.startsWith("./") && !normalized.startsWith(".") && !normalized.startsWith("/")) {
    return `./${normalized}`
  }

  return normalized
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/")
  const trailingSlash = path.endsWith("/")
  const parts: string[] = []

  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue
    }

    if (part === "..") {
      const previous = parts.at(-1)
      if (previous !== undefined && previous !== "..") {
        // Collapse ordinary parent references for deterministic URI strings.
        // This is not an access-control check; fetch policy belongs outside core.
        parts.pop()
      } else if (!absolute) {
        parts.push(part)
      }
      continue
    }

    parts.push(part)
  }

  let normalized = `${absolute ? "/" : ""}${parts.join("/")}`
  if (normalized.length === 0) {
    normalized = absolute ? "/" : "."
  }

  if (trailingSlash && !normalized.endsWith("/")) {
    normalized = `${normalized}/`
  }

  return normalized
}
