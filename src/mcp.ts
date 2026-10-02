#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { z } from "zod"
import { version } from "../package.json"
import { ARG_DESCRIPTIONS, generateImage, QUALITY_VALUES, TOOL_DESCRIPTION } from "./generate"

// Claude Code passes the project root as CLAUDE_PROJECT_DIR; other MCP clients start the server inside it.
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()

serveStdio(() => {
  const server = new McpServer({ name: "gpt-imagegen", version }, { capabilities: { tools: {} } })
  server.registerTool(
    "gpt_imagegen",
    {
      description: TOOL_DESCRIPTION,
      inputSchema: z.object({
        prompt: z.string().describe(ARG_DESCRIPTIONS.prompt),
        out: z.string().describe(ARG_DESCRIPTIONS.out),
        quality: z.enum(QUALITY_VALUES).describe(ARG_DESCRIPTIONS.quality),
        size: z.string().optional().describe(ARG_DESCRIPTIONS.size),
        images: z.array(z.string()).optional().describe(ARG_DESCRIPTIONS.images),
      }),
    },
    async (args) => {
      const { message } = await generateImage(args, projectDir)
      return { content: [{ type: "text", text: message }] }
    },
  )
  return server
})
