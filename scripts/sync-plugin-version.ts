// npm `version` lifecycle hook: package.json is already bumped, so copy its version into the Claude Code
// plugin manifest (Claude Code detects plugin updates by that version). The npm script then stages the file
// so it lands in the release commit. Only the version string is replaced to keep the file's formatting.
import { readFileSync, writeFileSync } from "node:fs"

const manifestPath = new URL("../.claude-plugin/plugin.json", import.meta.url)
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version: string
}
const manifest = readFileSync(manifestPath, "utf-8")
const updated = manifest.replace(/"version": "[^"]*"/, `"version": "${version}"`)
if (updated === manifest && !manifest.includes(`"version": "${version}"`)) {
  throw new Error("Could not find the version field in .claude-plugin/plugin.json")
}
writeFileSync(manifestPath, updated)
