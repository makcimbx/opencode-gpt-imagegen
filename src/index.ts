import type { Hooks, Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { resolveImageProvider } from "./auth"
import { callViaCodexResponses } from "./codex"
import { readReferenceImages } from "./input-image"
import { callViaOmniRoute } from "./omniroute"
import { saveGeneratedImage } from "./output-image"

const GptImagePlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      gpt_imagegen: tool({
        description: [
          "Generate raster images using Codex image_generation or OmniRoute image generation.",
          "Use for AI-created bitmap visuals such as photos, illustrations, textures, sprites, and mockups.",
          "Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.",
          "Reference images may be attached through `images`; label each image's role inline in `prompt`, for example: 'Image 1: reference image'.",
          "For many distinct assets, invoke gpt_imagegen once per requested asset rather than relying on multi-image output; gpt_imagegen returns one image per call.",
          "Defaults to ChatGPT/Codex OAuth when available, then falls back to OmniRoute API credentials; set GPT_IMAGEGEN_AUTH_PROVIDER=codex or omniroute to force a path. Returns the absolute path of the saved PNG.",
        ].join(" "),
        // https://developers.openai.com/api/docs/guides/image-generation
        args: {
          prompt: tool.schema.string().describe("Description of the image to generate."),
          out: tool.schema
            .string()
            .describe("Output file path, relative to the project directory unless absolute. The plugin writes a PNG."),
          quality: tool.schema
            .enum(["low", "medium", "high", "auto"])
            .describe(
              "Requested generation quality. Codex OAuth forwards it best-effort; OmniRoute currently omits it.",
            ),
          size: tool.schema
            .string()
            .optional()
            .describe(
              "Optional requested image size forwarded to the selected backend. Use `auto` or `WIDTHxHEIGHT`; width and height must be multiples of 16px, max edge <= 3840px, long-to-short ratio <= 3:1, and total pixels between 655,360 and 8,294,400. Codex-backed providers may return auto-selected dimensions.",
            ),
          images: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Optional reference image paths, relative to the project directory unless absolute."),
        },
        async execute(args, ctx) {
          const provider = await resolveImageProvider()
          const inputImageDataUrls = await readReferenceImages(args.images, ctx.directory)
          const base64 =
            provider.kind === "codex"
              ? await callViaCodexResponses(provider.auth, args, inputImageDataUrls)
              : await callViaOmniRoute(provider.auth, args, inputImageDataUrls)

          const { savedPath, versioned, message } = await saveGeneratedImage(args.out, ctx.directory, base64)

          return {
            output: message,
            metadata: {
              out: savedPath,
              versioned,
              provider: provider.kind,
              billing: provider.kind === "codex" ? "subscription" : "omniroute",
            },
          }
        },
      }),
    },
  }
}

export default {
  id: "opencode-gpt-imagegen",
  server: GptImagePlugin,
} satisfies PluginModule
