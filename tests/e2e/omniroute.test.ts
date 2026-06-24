import { beforeAll, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const WORKDIR = await mkdtemp(path.join(os.tmpdir(), "qa-imagegen-omni-work-"))
const XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "qa-imagegen-omni-cfg-"))
const REPO_DIR = path.resolve(import.meta.dir, "../..")
const RUN_TIMEOUT_MS = 600_000
const TEST_TIMEOUT_MS = RUN_TIMEOUT_MS + 10_000

async function buildPlugin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", "build"], {
      cwd: REPO_DIR,
      stdio: "inherit",
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`bun run build failed (exit=${code})`))
      else resolve()
    })
  })
}

async function writeOpencodeConfig(): Promise<void> {
  const cfgDir = path.join(XDG_CONFIG_HOME, "opencode")
  await mkdir(cfgDir, { recursive: true })
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugin: [pathToFileURL(REPO_DIR).href],
  }
  await writeFile(path.join(cfgDir, "opencode.jsonc"), JSON.stringify(config, null, 2))
}

async function runOpencode(prompt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["run", prompt, "--dir", WORKDIR, "--dangerously-skip-permissions"]
    if (process.env.OPENCODE_MODEL) args.push("--model", process.env.OPENCODE_MODEL)
    const proc = spawn("opencode", args, {
      stdio: "inherit",
      env: { ...process.env, XDG_CONFIG_HOME, GPT_IMAGEGEN_AUTH_PROVIDER: "omniroute" },
    })
    const timer = setTimeout(() => {
      proc.kill("SIGTERM")
    }, RUN_TIMEOUT_MS)
    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on("close", (code, signal) => {
      clearTimeout(timer)
      if (signal === "SIGTERM") {
        reject(new Error(`opencode run timed out after ${RUN_TIMEOUT_MS}ms`))
        return
      }
      if (code !== 0) {
        reject(new Error(`opencode run failed (exit=${code} signal=${signal ?? "null"})`))
        return
      }
      resolve()
    })
  })
}

async function assertPng(filePath: string): Promise<Buffer> {
  expect(existsSync(filePath)).toBe(true)
  const buf = await readFile(filePath)
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  return buf
}

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe("gpt_imagegen e2e (omniroute)", () => {
  beforeAll(async () => {
    console.log(`WORKDIR: ${WORKDIR}`)
    console.log(`XDG_CONFIG_HOME: ${XDG_CONFIG_HOME}`)
    await buildPlugin()
    await writeOpencodeConfig()
  })

  test(
    "text-to-image generation",
    async () => {
      await runOpencode(
        `Use the gpt_imagegen tool to generate an image at omni.png. ` +
          `Content: a small red robot watering a potted cactus on a sunny windowsill. ` +
          `Style: clean editorial illustration. Size: 1024x1024. Quality: medium.`,
      )
      const out = path.join(WORKDIR, "omni.png")
      const buf = await assertPng(out)
      const { width, height } = readPngDimensions(buf)
      expect(width).toBe(1024)
      expect(height).toBe(1024)
      console.log(`OmniRoute: ${out}`)
    },
    TEST_TIMEOUT_MS,
  )
})
