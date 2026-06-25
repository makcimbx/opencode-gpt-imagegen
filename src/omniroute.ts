import { Buffer } from "node:buffer"
import type { GenerateArgs, OmniRouteAuth } from "./types"

type OmniRouteImageGenerationResponse = {
  data?: Array<{ b64_json?: unknown; url?: unknown }>
}

export async function callViaOmniRoute(
  auth: OmniRouteAuth,
  args: GenerateArgs,
  inputImageDataUrls: string[],
): Promise<string> {
  const body: Record<string, unknown> = {
    model: auth.model,
    prompt: args.prompt,
    response_format: "b64_json",
    ...(args.size ? { size: args.size } : {}),
  }
  if (inputImageDataUrls.length > 0) {
    body.image_url = inputImageDataUrls[0]
    body.image_urls = inputImageDataUrls
  }

  const res = await fetch(`${auth.baseURL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.key}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`omniroute image generation request failed: ${res.status} ${detail.slice(0, 500)}`)
  }

  const json = (await res.json()) as OmniRouteImageGenerationResponse
  const image = json.data?.[0]
  if (typeof image?.b64_json === "string") return image.b64_json

  if (typeof image?.url === "string") {
    const imageRes = await fetch(image.url)
    if (!imageRes.ok) {
      const detail = await imageRes.text().catch(() => "")
      throw new Error(`omniroute image download failed: ${imageRes.status} ${detail.slice(0, 500)}`)
    }
    return Buffer.from(await imageRes.arrayBuffer()).toString("base64")
  }

  throw new Error("no image data returned by omniroute image generation endpoint")
}
