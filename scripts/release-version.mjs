import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const releaseRank = { patch: 1, minor: 2, major: 3 };

export function nextReleaseVersion(currentVersion, commits) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
  if (!match) throw new Error(`Expected a stable semantic version, received "${currentVersion}"`);

  let release;
  for (const commit of commits) {
    const type =
      /(^|\n)BREAKING[ -]CHANGE:/.test(commit) || /^[a-z]+(?:\([^)]*\))?!:/.test(commit)
        ? "major"
        : /^feat(?:\([^)]*\))?:/.test(commit)
          ? "minor"
          : /^(?:fix|perf)(?:\([^)]*\))?:/.test(commit)
            ? "patch"
            : undefined;
    if (!release || (type && releaseRank[type] > releaseRank[release])) release = type;
  }

  if (!release) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (release === "major") return `${major + 1}.0.0`;
  if (release === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main() {
  const tags = git("tag", "--merged", "HEAD", "--list", "v[0-9]*", "--sort=-v:refname")
    .split("\n")
    .filter(Boolean);
  const latestTag = tags[0];
  const currentVersion =
    latestTag?.slice(1) ?? JSON.parse(readFileSync("package.json", "utf8")).version;
  const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const commits = git("log", range, "--format=%B%x00").split("\0").filter(Boolean);
  const version = nextReleaseVersion(currentVersion, commits);

  if (process.env.GITHUB_OUTPUT) {
    const output = version ? `release=true\nversion=${version}\n` : "release=false\n";
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  }
  console.log(version ?? "No release-worthy commits found.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
