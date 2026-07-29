import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"

const LEVELS = ["patch", "minor", "major"] as const
type ReleaseLevel = (typeof LEVELS)[number]

function run(command: string, args: string[], inherit = false): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim()
    throw new Error(detail || `${command} ${args.join(" ")} exited with code ${result.status}`)
  }

  return typeof result.stdout === "string" ? result.stdout.trim() : ""
}

function tryRun(command: string, args: string[]): string {
  try {
    return run(command, args)
  } catch {
    return ""
  }
}

function nextVersion(current: string, level: ReleaseLevel): string {
  const parts = current.split(".").map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`package.json has unsupported version '${current}'`)
  }

  const [major, minor, patch] = parts as [number, number, number]
  if (level === "patch") return `${major}.${minor}.${patch + 1}`
  if (level === "minor") return `${major}.${minor + 1}.0`
  return `${major + 1}.0.0`
}

function repositoryUrl(remoteUrl: string): string {
  const withoutSuffix = remoteUrl.replace(/\.git$/, "")
  const sshMatch = withoutSuffix.match(/^git@([^:]+):(.+)$/)
  return sshMatch ? `https://${sshMatch[1]}/${sshMatch[2]}` : withoutSuffix
}

function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: unknown
  }
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json has no string version")
  }
  return packageJson.version
}

async function main(): Promise<void> {
  const requestedLevel = process.argv[2]
  if (!LEVELS.includes(requestedLevel as ReleaseLevel)) {
    throw new Error(`level must be patch|minor|major (got: ${requestedLevel ?? "missing"})`)
  }
  const level = requestedLevel as ReleaseLevel

  if (run("git", ["status", "--porcelain"])) {
    throw new Error("working tree is not clean (commit or stash the changes first)")
  }

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"])
  if (currentBranch !== "main") {
    throw new Error(`must be on 'main' (currently on '${currentBranch}')`)
  }

  const upstreamRef = tryRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  if (!upstreamRef) throw new Error("local 'main' has no upstream branch")

  const remote = tryRun("git", ["config", "--get", `branch.${currentBranch}.remote`])
  const mergeRef = tryRun("git", ["config", "--get", `branch.${currentBranch}.merge`])
  if (!remote || remote === "." || !mergeRef.startsWith("refs/heads/")) {
    throw new Error("local 'main' is not tracking a remote branch")
  }

  const remoteBranch = mergeRef.slice("refs/heads/".length)
  run("git", ["fetch", "--quiet", remote, remoteBranch])
  if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", upstreamRef])) {
    throw new Error(`local 'main' is out of sync with '${upstreamRef}' (pull or push first)`)
  }

  const current = packageVersion()
  const next = nextVersion(current, level)
  const releaseTag = `v${next}`
  const previousTag = tryRun("git", ["describe", "--tags", "--abbrev=0"])
  const originalHead = run("git", ["rev-parse", "HEAD"])
  const headSha = run("git", ["rev-parse", "--short", "HEAD"])
  const repoUrl = repositoryUrl(run("git", ["remote", "get-url", remote]))

  console.log("============================================")
  console.log(`  Release: v${current} -> v${next}  (${level})`)
  console.log("============================================")
  console.log()

  if (!previousTag) {
    console.log("(no previous tag found; skipping diff review)")
  } else {
    console.log(`Commits (${previousTag}..HEAD):`)
    console.log(run("git", ["log", "--pretty=format:  %h %s", `${previousTag}..HEAD`]))
    console.log()
    console.log()
    console.log("Review:")
    console.log(`  ${repoUrl}/compare/${previousTag}...${headSha}`)
  }

  console.log()
  const readline = createInterface({ input: stdin, output: stdout })
  const reply = await readline.question(`Proceed with v${next}? (y/N) `)
  readline.close()
  if (!/^y$/i.test(reply.trim())) {
    console.log("Aborted.")
    process.exitCode = 1
    return
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
  run(
    npmCommand,
    ["version", level, "--git-tag-version=true", "--tag-version-prefix=v", "-m", "chore: release %s"],
    true,
  )

  const releaseHead = run("git", ["rev-parse", "HEAD"])
  if (run("git", ["rev-parse", "HEAD^"]) !== originalHead) {
    throw new Error("release commit is not based directly on the reviewed commit")
  }
  if (packageVersion() !== next) {
    throw new Error(`package.json version is not ${next} after npm version`)
  }
  if (run("git", ["rev-parse", `${releaseTag}^{commit}`]) !== releaseHead) {
    throw new Error(`tag '${releaseTag}' does not point to the release commit`)
  }
  if (run("git", ["status", "--porcelain"])) {
    throw new Error("working tree is not clean after npm version")
  }

  run(
    "git",
    ["push", "--atomic", remote, `HEAD:refs/heads/${remoteBranch}`, `refs/tags/${releaseTag}:refs/tags/${releaseTag}`],
    true,
  )
}

try {
  await main()
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
