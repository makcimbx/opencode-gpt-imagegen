import type { Hooks, Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { ARG_DESCRIPTIONS, generateImage, QUALITY_VALUES, TOOL_DESCRIPTION } from "./generate"

const GptImagePlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      gpt_imagegen: tool({
        description: TOOL_DESCRIPTION,
        args: {
          prompt: tool.schema.string().describe(ARG_DESCRIPTIONS.prompt),
          out: tool.schema.string().describe(ARG_DESCRIPTIONS.out),
          quality: tool.schema.enum(QUALITY_VALUES).describe(ARG_DESCRIPTIONS.quality),
          size: tool.schema.string().optional().describe(ARG_DESCRIPTIONS.size),
          images: tool.schema.array(tool.schema.string()).optional().describe(ARG_DESCRIPTIONS.images),
        },
        async execute(args, ctx) {
          const { savedPath, versioned, message, provider } = await generateImage(args, ctx.directory)

          return {
            output: message,
            metadata: {
              out: savedPath,
              versioned,
              provider,
              billing: provider === "codex" ? "subscription" : "omniroute",
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
