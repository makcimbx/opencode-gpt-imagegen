import * as fs from "node:fs/promises"
import * as path from "node:path"
import { xdgConfig, xdgData } from "xdg-basedir"
import type { ImageProvider, ImageProviderMode, OmniRouteAuth, OpenAIAuth } from "./types"

const DEFAULT_OMNIROUTE_BASE_URL = "http://localhost:20128/v1"
const DEFAULT_OMNIROUTE_MODEL = "codex/gpt-5.6-sol"

// Mirrors OpenCode's auth resolution: OPENCODE_AUTH_CONTENT overrides $XDG_DATA_HOME/opencode/auth.json.
// The Auth service is not exposed to external plugins, so this reproduces the rules directly.
async function loadAuthData(): Promise<Record<string, unknown>> {
  if (process.env.OPENCODE_AUTH_CONTENT) {
    return JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, unknown>
  }
  if (!xdgData) {
    throw new Error("could not determine XDG data directory")
  }
  const raw = await fs.readFile(path.join(xdgData, "opencode", "auth.json"), "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stripJsonComments(input: string): string {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const next = input[i + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++
      output += "\n"
      continue
    }

    if (char === "/" && next === "*") {
      i += 2
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++
      i++
      continue
    }

    output += char
  }

  return output
}

function parseJsonc(raw: string): Record<string, unknown> {
  return JSON.parse(stripJsonComments(raw).replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>
}

async function loadOpenCodeConfig(): Promise<Record<string, unknown> | undefined> {
  const configHome = process.env.XDG_CONFIG_HOME ?? xdgConfig
  if (!configHome) return undefined

  for (const fileName of ["opencode.jsonc", "opencode.json"]) {
    try {
      const raw = await fs.readFile(path.join(configHome, "opencode", fileName), "utf-8")
      return parseJsonc(raw)
    } catch {
      // Try the next supported config filename.
    }
  }

  return undefined
}

function getStandardOmniRouteOptions(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const provider = isRecord(config?.provider) ? config.provider : undefined
  const omniroute = isRecord(provider?.omniroute) ? provider.omniroute : undefined
  return isRecord(omniroute?.options) ? omniroute.options : undefined
}

function hasOmniRouteMarker(value: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("omniroute")
  if (Array.isArray(value)) return value.some(hasOmniRouteMarker)
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([key, entry]) => key.toLowerCase().includes("omniroute") || hasOmniRouteMarker(entry),
  )
}

function getOmniRouteWrapperOptions(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!Array.isArray(config?.plugin)) return undefined

  for (const plugin of config.plugin) {
    if (!hasOmniRouteMarker(plugin)) continue

    if (Array.isArray(plugin)) {
      for (const entry of plugin) {
        if (isRecord(entry) && (entry.providerId === "omniroute" || entry.baseURL || entry.apiKey)) return entry
        if (isRecord(entry) && isRecord(entry.options)) return entry.options
      }
    }

    if (isRecord(plugin)) {
      if (isRecord(plugin.options)) return plugin.options
      if (plugin.providerId === "omniroute" || plugin.baseURL || plugin.apiKey) return plugin
    }
  }

  return undefined
}

function getOmniRouteApiKeyFromAuth(data: Record<string, unknown> | undefined): string | undefined {
  const entry = isRecord(data?.omniroute) ? data.omniroute : undefined
  if (entry?.type !== "api") return undefined
  return stringValue(entry.key) ?? stringValue(entry.apiKey) ?? stringValue(entry.access) ?? stringValue(entry.token)
}

export function normalizeOmniRouteBaseURL(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) throw new Error("OmniRoute base URL is empty")

  const url = new URL(trimmed)
  let pathname = url.pathname.replace(/\/+$/, "")
  pathname = pathname.replace(/\/images\/generations$/i, "")
  while (/\/v1\/v1$/i.test(pathname)) pathname = pathname.replace(/\/v1\/v1$/i, "/v1")
  if (!/\/v1$/i.test(pathname)) pathname = `${pathname}/v1`
  url.pathname = pathname
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/+$/, "")
}

export async function loadOpenAIAuth(): Promise<OpenAIAuth | undefined> {
  try {
    const data = await loadAuthData()
    const entry = data.openai as Partial<OpenAIAuth> | undefined
    if (entry?.type === "oauth" && typeof entry.access === "string") {
      return entry as OpenAIAuth
    }
  } catch {
    return undefined
  }
  return undefined
}

export async function loadOmniRouteAuth(): Promise<OmniRouteAuth | undefined> {
  const authData = await loadAuthData().catch(() => undefined)
  const config = await loadOpenCodeConfig()
  const standardOptions = getStandardOmniRouteOptions(config)
  const wrapperOptions = getOmniRouteWrapperOptions(config)

  const key =
    getOmniRouteApiKeyFromAuth(authData) ?? stringValue(standardOptions?.apiKey) ?? stringValue(wrapperOptions?.apiKey)
  if (!key) return undefined

  const baseURL = normalizeOmniRouteBaseURL(
    process.env.GPT_IMAGEGEN_OMNIROUTE_BASE_URL ??
      stringValue(standardOptions?.baseURL) ??
      stringValue(wrapperOptions?.baseURL) ??
      DEFAULT_OMNIROUTE_BASE_URL,
  )
  const model = process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL?.trim() || DEFAULT_OMNIROUTE_MODEL

  return { type: "api", key, baseURL, model }
}

function getImageProviderMode(): ImageProviderMode {
  const mode = process.env.GPT_IMAGEGEN_AUTH_PROVIDER ?? "auto"
  if (mode === "auto" || mode === "codex" || mode === "omniroute") return mode
  throw new Error("Invalid GPT_IMAGEGEN_AUTH_PROVIDER. Expected one of: auto, codex, omniroute.")
}

export async function resolveImageProvider(): Promise<ImageProvider> {
  const mode = getImageProviderMode()

  if (mode === "auto" || mode === "codex") {
    const openai = await loadOpenAIAuth()
    if (openai) return { kind: "codex", auth: openai }
    if (mode === "codex") {
      throw new Error("Codex provider requested, but OpenAI ChatGPT OAuth credentials are not configured.")
    }
  }

  const omniroute = await loadOmniRouteAuth()
  if (omniroute) return { kind: "omniroute", auth: omniroute }
  if (mode === "omniroute") {
    throw new Error("OmniRoute provider requested, but OmniRoute API credentials are not configured.")
  }

  throw new Error(
    "No image provider credentials configured. Connect OpenAI ChatGPT OAuth in OpenCode or configure OmniRoute API credentials.",
  )
}
