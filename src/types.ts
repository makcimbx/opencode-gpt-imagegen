// Minimal subset of OpenCode auth.json's openai OAuth entry required by this plugin.
export type OpenAIAuth = { type: "oauth"; access: string; accountId?: string }

export type OmniRouteAuth = { type: "api"; key: string; baseURL: string; model: string }

export type ImageProviderMode = "auto" | "codex" | "omniroute"

export type ImageProvider = { kind: "codex"; auth: OpenAIAuth } | { kind: "omniroute"; auth: OmniRouteAuth }

export type GenerateArgs = {
  prompt: string
  out: string
  quality: "low" | "medium" | "high" | "auto"
  size?: string
  images?: string[]
}
