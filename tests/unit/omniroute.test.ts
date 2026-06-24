import { afterEach, describe, expect, mock, test } from "bun:test"
import { Buffer } from "node:buffer"
import { callViaOmniRoute } from "../../src/omniroute"
import type { GenerateArgs, OmniRouteAuth } from "../../src/types"

describe("callViaOmniRoute", () => {
  const originalFetch = globalThis.fetch
  const auth: OmniRouteAuth = { type: "api", key: "omni-key", baseURL: "https://llm.example/v1", model: "auto" }

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("posts to the images endpoint and parses b64_json", async () => {
    const fetchMock = mock(async (_url: string, _init: RequestInit) =>
      Response.json({ data: [{ b64_json: "BASE64IMAGE" }] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "high", size: "1024x1024" }
    const result = await callViaOmniRoute(auth, args, [])

    expect(result).toBe("BASE64IMAGE")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://llm.example/v1/images/generations")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer omni-key",
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: "auto",
      prompt: "a cat",
      response_format: "b64_json",
      size: "1024x1024",
    })
  })

  test("omits optional size and unverified quality field", async () => {
    const fetchMock = mock(async (_url: string, _init: RequestInit) =>
      Response.json({ data: [{ b64_json: "BASE64IMAGE" }] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "auto" }
    await callViaOmniRoute(auth, args, [])

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({
      model: "auto",
      prompt: "a cat",
      response_format: "b64_json",
    })
  })

  test("downloads and base64-encodes URL responses", async () => {
    const fetchMock = mock(async (url: string, _init?: RequestInit) => {
      if (url === "https://cdn.example/image.png") return new Response(new Uint8Array([1, 2, 3]))
      return Response.json({ data: [{ url: "https://cdn.example/image.png" }] })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "auto" }
    expect(await callViaOmniRoute(auth, args, [])).toBe(Buffer.from([1, 2, 3]).toString("base64"))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("throws with status and body when the generation request fails", async () => {
    const fetchMock = mock(async (_url: string, _init: RequestInit) => new Response("upstream boom", { status: 500 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "auto" }
    expect(callViaOmniRoute(auth, args, [])).rejects.toThrow(
      "omniroute image generation request failed: 500 upstream boom",
    )
  })

  test("throws clearly when reference images are passed", async () => {
    const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "auto" }
    expect(callViaOmniRoute(auth, args, ["data:image/png;base64,AAA"])).rejects.toThrow(
      "OmniRoute image generation currently supports text-to-image only; reference images are not supported in OmniRoute mode yet.",
    )
  })
})
