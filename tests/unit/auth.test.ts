import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const XDG = mkdtempSync(path.join(os.tmpdir(), "auth-xdg-"))
const AUTH_FILE = path.join(XDG, "opencode", "auth.json")
const CONFIG_XDG = mkdtempSync(path.join(os.tmpdir(), "auth-cfg-"))
const CONFIG_FILE = path.join(CONFIG_XDG, "opencode", "opencode.jsonc")
mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })

// Capture so this file's env edits don't leak into other test files sharing the Bun process;
// the E2E launchers spawn opencode with ...process.env.
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME
const ORIGINAL_AUTH_CONTENT = process.env.OPENCODE_AUTH_CONTENT
const ORIGINAL_AUTH_PROVIDER = process.env.GPT_IMAGEGEN_AUTH_PROVIDER
const ORIGINAL_OMNIROUTE_BASE_URL = process.env.GPT_IMAGEGEN_OMNIROUTE_BASE_URL
const ORIGINAL_OMNIROUTE_MODEL = process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL
let loadOpenAIAuth: typeof import("../../src/auth").loadOpenAIAuth
let loadOmniRouteAuth: typeof import("../../src/auth").loadOmniRouteAuth
let normalizeOmniRouteBaseURL: typeof import("../../src/auth").normalizeOmniRouteBaseURL
let resolveImageProvider: typeof import("../../src/auth").resolveImageProvider

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeAll(async () => {
  // xdg-basedir captures XDG_DATA_HOME at import, so point it at the temp dir before
  // importing the module under test (which transitively imports xdg-basedir).
  process.env.XDG_DATA_HOME = XDG
  process.env.XDG_CONFIG_HOME = CONFIG_XDG
  const auth = await import("../../src/auth")
  loadOpenAIAuth = auth.loadOpenAIAuth
  loadOmniRouteAuth = auth.loadOmniRouteAuth
  normalizeOmniRouteBaseURL = auth.normalizeOmniRouteBaseURL
  resolveImageProvider = auth.resolveImageProvider
})

afterAll(() => {
  restoreEnv("XDG_DATA_HOME", ORIGINAL_XDG_DATA_HOME)
  restoreEnv("XDG_CONFIG_HOME", ORIGINAL_XDG_CONFIG_HOME)
  restoreEnv("OPENCODE_AUTH_CONTENT", ORIGINAL_AUTH_CONTENT)
  restoreEnv("GPT_IMAGEGEN_AUTH_PROVIDER", ORIGINAL_AUTH_PROVIDER)
  restoreEnv("GPT_IMAGEGEN_OMNIROUTE_BASE_URL", ORIGINAL_OMNIROUTE_BASE_URL)
  restoreEnv("GPT_IMAGEGEN_OMNIROUTE_MODEL", ORIGINAL_OMNIROUTE_MODEL)
})

function writeAuthFile(content: string): void {
  writeFileSync(AUTH_FILE, content)
}

function writeConfigFile(content: string): void {
  writeFileSync(CONFIG_FILE, content)
}

beforeEach(() => {
  delete process.env.OPENCODE_AUTH_CONTENT
  delete process.env.GPT_IMAGEGEN_AUTH_PROVIDER
  delete process.env.GPT_IMAGEGEN_OMNIROUTE_BASE_URL
  delete process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL
  // Start each test from a no-credentials baseline; tests opt in to a file.
  writeAuthFile("{}")
  writeConfigFile("{}")
})

afterEach(() => {
  delete process.env.OPENCODE_AUTH_CONTENT
  delete process.env.GPT_IMAGEGEN_AUTH_PROVIDER
  delete process.env.GPT_IMAGEGEN_OMNIROUTE_BASE_URL
  delete process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL
})

describe("loadOpenAIAuth", () => {
  test("reads a valid oauth entry from OPENCODE_AUTH_CONTENT", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "tok-env", accountId: "acct-1" },
    })
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-env", accountId: "acct-1" })
  })

  test("prefers OPENCODE_AUTH_CONTENT over the auth.json file", async () => {
    writeAuthFile(JSON.stringify({ openai: { type: "oauth", access: "tok-file" } }))
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "tok-env" } })
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-env" })
  })

  test("falls back to the auth.json file when the env var is unset", async () => {
    writeAuthFile(JSON.stringify({ openai: { type: "oauth", access: "tok-file" } }))
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-file" })
  })

  test("returns undefined when the entry is not an oauth type", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "api", access: "tok" } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when access is not a string", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: 123 } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when there is no openai entry", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ anthropic: { type: "oauth", access: "tok" } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when the content is not valid JSON", async () => {
    process.env.OPENCODE_AUTH_CONTENT = "{not json"
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when the auth.json file is missing", async () => {
    rmSync(AUTH_FILE, { force: true })
    // The read rejects; loadOpenAIAuth swallows it and reports no credentials.
    expect(await loadOpenAIAuth()).toBeUndefined()
  })
})

describe("loadOmniRouteAuth", () => {
  test("reads an API-key entry from OpenCode auth data", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "omni-key" } })
    expect(await loadOmniRouteAuth()).toEqual({
      type: "api",
      key: "omni-key",
      baseURL: "http://localhost:20128/v1",
      model: "codex/gpt-6.1-sol",
    })
  })

  test("reads API key and base URL from standard provider options", async () => {
    writeConfigFile(
      JSON.stringify({
        provider: { omniroute: { options: { apiKey: "cfg-key", baseURL: "https://llm.example/v1/" } } },
      }),
    )

    expect(await loadOmniRouteAuth()).toEqual({
      type: "api",
      key: "cfg-key",
      baseURL: "https://llm.example/v1",
      model: "codex/gpt-6.1-sol",
    })
  })

  test("reads base URL from an OmniRoute wrapper plugin entry", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "auth-key" } })
    writeConfigFile(
      JSON.stringify({
        plugin: [
          {
            path: "./plugins/omniroute-wrapper.ts",
            options: { providerId: "omniroute", baseURL: "https://llm.example" },
          },
        ],
      }),
    )

    expect(await loadOmniRouteAuth()).toEqual({
      type: "api",
      key: "auth-key",
      baseURL: "https://llm.example/v1",
      model: "codex/gpt-6.1-sol",
    })
  })

  test("env base URL and model override config defaults", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "auth-key" } })
    process.env.GPT_IMAGEGEN_OMNIROUTE_BASE_URL = "https://env.example/api/v1"
    process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL = "image-model"

    expect(await loadOmniRouteAuth()).toEqual({
      type: "api",
      key: "auth-key",
      baseURL: "https://env.example/api/v1",
      model: "image-model",
    })
  })

  test("uses the default model for a blank override", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "auth-key" } })
    process.env.GPT_IMAGEGEN_OMNIROUTE_MODEL = "  "

    expect((await loadOmniRouteAuth())?.model).toBe("codex/gpt-6.1-sol")
  })

  test("normalizes base URLs without duplicate /v1", () => {
    expect(normalizeOmniRouteBaseURL("https://llm.example")).toBe("https://llm.example/v1")
    expect(normalizeOmniRouteBaseURL("https://llm.example/v1/")).toBe("https://llm.example/v1")
    expect(normalizeOmniRouteBaseURL("https://llm.example/v1/v1")).toBe("https://llm.example/v1")
  })
})

describe("resolveImageProvider", () => {
  test("auto chooses Codex when both Codex and OmniRoute auth are present", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "codex-token" },
      omniroute: { type: "api", key: "omni-key" },
    })

    expect(await resolveImageProvider()).toEqual({ kind: "codex", auth: { type: "oauth", access: "codex-token" } })
  })

  test("auto falls back to OmniRoute when Codex OAuth is absent", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "omni-key" } })

    expect(await resolveImageProvider()).toEqual({
      kind: "omniroute",
      auth: { type: "api", key: "omni-key", baseURL: "http://localhost:20128/v1", model: "codex/gpt-6.1-sol" },
    })
  })

  test("forced Codex ignores OmniRoute and fails when Codex OAuth is absent", async () => {
    process.env.GPT_IMAGEGEN_AUTH_PROVIDER = "codex"
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ omniroute: { type: "api", key: "omni-key" } })

    expect(resolveImageProvider()).rejects.toThrow(
      "Codex provider requested, but OpenAI ChatGPT OAuth credentials are not configured.",
    )
  })

  test("forced OmniRoute ignores Codex and selects OmniRoute when available", async () => {
    process.env.GPT_IMAGEGEN_AUTH_PROVIDER = "omniroute"
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "codex-token" },
      omniroute: { type: "api", key: "omni-key" },
    })

    expect(await resolveImageProvider()).toEqual({
      kind: "omniroute",
      auth: { type: "api", key: "omni-key", baseURL: "http://localhost:20128/v1", model: "codex/gpt-6.1-sol" },
    })
  })

  test("invalid provider mode fails clearly", async () => {
    process.env.GPT_IMAGEGEN_AUTH_PROVIDER = "bogus"
    expect(resolveImageProvider()).rejects.toThrow(
      "Invalid GPT_IMAGEGEN_AUTH_PROVIDER. Expected one of: auto, codex, omniroute.",
    )
  })
})
