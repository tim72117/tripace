# @tripace/partner-claude-skill

Claude Code skill installer for the `tripace-partner-cli-setup` skill —
helps Tripace advertiser/affiliate partners (and anyone assisting them)
install and use `partner-cli` to manage their own ad campaigns and plan
content from the terminal, instead of (or alongside) the web console
(`web/partner`).

Mirrors the design of 另一個專案(`agent` repo)的
`packages/claude-skill`(onagent CLI installer)——see that package's
README for the original rationale this copies: explicit-invocation
install (not `postinstall`), binary not bundled into the npm package.

`skill/SKILL.md` in this directory is the only copy of the
`tripace-partner-cli-setup` skill in this repo — this directory is the
source of truth for editing the skill's content.

## Usage

```
npx @tripace/partner-claude-skill            # installs to ./.claude/skills/tripace-partner-cli-setup
npx @tripace/partner-claude-skill --user     # installs to ~/.claude/skills/tripace-partner-cli-setup
npx @tripace/partner-claude-skill version    # shows the installed and latest partner-cli release
npx @tripace/partner-claude-skill upgrade    # re-downloads the current platform's binary if a newer release exists
```

(Once published, the shorter `npx tripace-partner-cli-setup` form also
works via the `bin` entry in `package.json`.)

`version`/`upgrade` operate on whichever install `--user` selects — pass
the same flag you installed with if you installed with `--user`.

This is an explicit, user-invoked install (not a `postinstall` script) —
npm and GitHub are moving toward disabling install scripts by default, so
anything that auto-copies files on `npm install` is a fading, riskier
pattern. Running this only happens when someone actually types the
command.

## The partner-cli binary isn't bundled

This package carries no `partner-cli` binary at all. `bin/cli.js`
downloads the current platform's binary straight from this repo's GitHub
Releases (built by `.github/workflows/release-partner-cli.yml`) the
moment someone runs `npx @tripace/partner-claude-skill` (install) or
`... upgrade`, so a user always gets whatever's newest there — never
something pinned to whenever this npm package itself was last published.

`.partner-cli-version` (written next to the downloaded binary) records
which release tag was installed — the binary itself carries no version
string unless built via that workflow's `-X main.version=...` flag (which
it is, for release builds; `go run`/`go build` without that flag locally
default to `"dev"`, see `server/cmd/partner-cli/main.go`).

Releases are tagged `partner-cli-v*` (not the bare `v*` the main `server`
deploy uses) — `cli.js` specifically looks for the first release whose
assets start with `partner-cli-`, rather than trusting
`GET /releases/latest` naively, since this repo also publishes other
kinds of releases under the same `/releases` endpoint.

Platforms covered: whatever `release-partner-cli.yml`'s build matrix
currently publishes (as of this writing: Windows amd64, macOS
Intel/Apple Silicon, Linux amd64/arm64). `cli.js` prints a clear message
and exits without attempting a download on any other platform/arch
combination — `SKILL.md`'s own fallback instructions cover that case.

## Who this is for

`partner-cli` only talks to the main server's `/partner/api/*` endpoints (default `https://tripace.io`)
— it authenticates with a regular Tripace user account that has been
granted partner status by Tripace (an internal-only
operation with no self-serve flow yet). It cannot do anything an
advertiser/affiliate partner couldn't already do through the
`web/partner` web console; the CLI is purely a terminal-friendly
alternative for the same data.

## Publishing

```
npm publish --access public
```

## Releasing a new partner-cli binary

Push a tag matching `partner-cli-v*` (e.g. `partner-cli-v0.1.0`) to
trigger `.github/workflows/release-partner-cli.yml`, or run it manually
via `workflow_dispatch` for an unreleased draft build.
