import { expect, test } from "bun:test"
import pluginManifest from "../../.claude-plugin/plugin.json"
import packageJson from "../../package.json"

test("Claude Code plugin manifest version matches package.json", () => {
  expect(pluginManifest.version).toBe(packageJson.version)
})
