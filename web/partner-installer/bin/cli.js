#!/usr/bin/env node
// Explicit-invocation installer (npx tripace-partner-cli-setup), not a
// postinstall script — postinstall auto-copy is the pattern npm/GitHub
// are moving away from by disabling install scripts by default, so this
// only runs when the user actually asks for it. Mirrors the design of
// agent 專案 packages/claude-skill(onagent CLI installer)——see that
// package's bin/cli.js/README.md for the original rationale this copies.
//
// This package does NOT bundle a partner-cli binary — it downloads the
// current platform's from this repo's GitHub Releases (built by
// .github/workflows/release-partner-cli.yml) at install/upgrade time, so
// a user always gets whatever's newest there, independent of when this
// npm package itself was last published. A `.partner-cli-version` marker
// file is written alongside the installed binary to record which release
// was downloaded, since the binary itself carries no version string
// unless built via that workflow's -ldflags="-X main.version=...".
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform, arch } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')
const skillSource = join(packageRoot, 'skill')

const RELEASES_API = 'https://api.github.com/repos/tim72117/tripace/releases/latest'

const userLevel = process.argv.includes('--user')
const target = userLevel
  ? join(homedir(), '.claude', 'skills', 'tripace-partner-cli-setup')
  : join(process.cwd(), '.claude', 'skills', 'tripace-partner-cli-setup')
const targetBin = join(target, 'bin')
const versionMarker = join(target, '.partner-cli-version')

// Maps Node's os.platform()/os.arch() to the <os>-<arch> suffix
// release-partner-cli.yml's build matrix uses for its asset names.
// Returns null for a platform/arch combination that build matrix
// doesn't cover (currently darwin/windows/linux × amd64/arm64, no
// windows-arm64 or 32-bit targets — see release-partner-cli.yml).
function platformSuffix() {
  const os = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[platform()]
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch()]
  if (!os || !cpu) return null
  if (os === 'windows' && cpu === 'arm64') return null // not built — see release-partner-cli.yml
  return `${os}-${cpu}`
}

function assetInfoForSuffix(suffix) {
  const isWindows = suffix.startsWith('windows-')
  const archiveExt = isWindows ? 'zip' : 'tar.gz'
  const binaryName = isWindows ? `partner-cli-${suffix}.exe` : `partner-cli-${suffix}`
  return { archiveName: `partner-cli-${suffix}.${archiveExt}`, archiveExt, binaryName }
}

// GitHub Releases API 預設回傳整個 repo「最新」的 release,但這個
// repo 同時發布 cmd/server 的正式部署版本(見其他 workflow)——
// release-partner-cli.yml 用獨立的 partner-cli-v* tag 前綴(跟
// Dockerfile/deploy-cloudrun.yml 無關),所以這裡改用 /releases 列表
// 找「第一個 asset 名稱是 partner-cli-* 開頭」的 release,而不是直接
// 信任 /releases/latest——避免兩種 release tag 共用同一個 repo 時,
// /releases/latest 回傳的其實是主服務的部署 release(資產名稱完全
// 不同),導致 asset 永遠找不到而誤判成「這個 release 沒有這個平台」。
async function fetchLatestPartnerCliRelease() {
  const listURL = RELEASES_API.replace('/latest', '')
  // per_page=100(GitHub 允許的上限)——這個 repo 的 deploy-cloudrun.yml
  // 會在每次主服務部署時自動建立一個 v* release,預設的 30 筆分頁大小
  // 撐不了多久就會把真正的 partner-cli-v* release 擠出第一頁,導致這裡
  // 永遠找不到(明明存在),見本函式上方的完整說明。
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${listURL}?per_page=100&page=${page}`, {
      headers: { 'User-Agent': 'tripace-partner-cli-setup' },
    })
    if (!res.ok) {
      throw new Error(`GitHub Releases API returned ${res.status} ${res.statusText}`)
    }
    const releases = await res.json()
    if (releases.length === 0) break
    const found = releases.find((r) => r.assets?.some((a) => a.name.startsWith('partner-cli-')))
    if (found) return found
    if (releases.length < 100) break
  }
  throw new Error('No partner-cli release found in this repo yet.')
}

async function downloadAsset(url, destPath) {
  const res = await fetch(url, { headers: { 'User-Agent': 'tripace-partner-cli-setup' } })
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`)
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath))
}

// Extracts exactly the one binary this platform needs out of the
// downloaded archive, into targetBin. .zip (Windows releases) is handled
// via PowerShell's Expand-Archive — Windows's bundled bsdtar cannot
// reliably extract the .zip files Compress-Archive-style tooling
// produces, even though it otherwise supports .tar.gz fine for the
// darwin/linux assets (same caveat as agent 專案的 onagent installer)。
function extractArchive(archivePath, archiveExt, binaryName) {
  if (archiveExt === 'zip') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${targetBin}' -Force`,
    ])
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', targetBin])
  }
  const extracted = join(targetBin, binaryName)
  if (!existsSync(extracted)) {
    throw new Error(`Expected ${binaryName} in the extracted archive but didn't find it.`)
  }
  if (archiveExt === 'tar.gz') {
    chmodSync(extracted, 0o755) // tar preserves the executable bit; belt-and-suspenders in case it didn't
  }
}

// Downloads and installs the current platform's partner-cli binary from
// the given release into targetBin, replacing whatever was there. Shared
// by both the initial skill install and `upgrade` — the two differ only
// in what they print and whether they also (re-)copy skill/ (SKILL.md).
async function installBinaryFromRelease(release, suffix) {
  const { archiveName, archiveExt, binaryName } = assetInfoForSuffix(suffix)
  const asset = release.assets.find((a) => a.name === archiveName)
  if (!asset) {
    throw new Error(`Release ${release.tag_name} has no asset named ${archiveName}.`)
  }

  mkdirSync(targetBin, { recursive: true })
  const tmpArchive = join(targetBin, `.download-${archiveName}`)
  await downloadAsset(asset.browser_download_url, tmpArchive)
  try {
    extractArchive(tmpArchive, archiveExt, binaryName)
  } finally {
    rmSync(tmpArchive, { force: true })
  }

  writeFileSync(versionMarker, release.tag_name)
  return binaryName
}

function readInstalledVersion() {
  return existsSync(versionMarker) ? readFileSync(versionMarker, 'utf8').trim() : null
}

async function cmdInstall() {
  if (!existsSync(skillSource)) {
    console.error(`Bundled skill content missing at ${skillSource} — package install may be corrupt.`)
    process.exitCode = 1
    return
  }

  const suffix = platformSuffix()
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), readFileSync(join(skillSource, 'SKILL.md')))

  console.log(`Installed tripace-partner-cli-setup skill to ${target}`)

  if (!suffix) {
    console.log(`No partner-cli binary is published for your platform (${platform()}/${arch()}) — see SKILL.md's fallback instructions.`)
    return
  }

  console.log('Fetching the latest partner-cli release…')
  const release = await fetchLatestPartnerCliRelease()
  const binaryName = await installBinaryFromRelease(release, suffix)
  console.log(`Downloaded partner-cli ${release.tag_name} (${binaryName}) to ${targetBin}`)
}

async function cmdVersion() {
  const installed = readInstalledVersion()
  if (!installed) {
    console.log('No partner-cli binary installed here yet — run without a subcommand to install.')
    return
  }
  console.log(`Installed: ${installed}`)

  const release = await fetchLatestPartnerCliRelease()
  console.log(`Latest:    ${release.tag_name}`)
  if (release.tag_name !== installed) {
    console.log("A newer version is available — run 'upgrade' to update.")
  } else {
    console.log('Up to date.')
  }
}

async function cmdUpgrade() {
  const suffix = platformSuffix()
  if (!suffix) {
    console.error(`No partner-cli binary is published for your platform (${platform()}/${arch()}).`)
    process.exitCode = 1
    return
  }
  if (!existsSync(target)) {
    console.error(`${target} doesn't exist yet — run without a subcommand to install first.`)
    process.exitCode = 1
    return
  }

  const installed = readInstalledVersion()
  const release = await fetchLatestPartnerCliRelease()
  if (release.tag_name === installed) {
    console.log(`Already up to date (${installed}).`)
    return
  }

  console.log(`Upgrading partner-cli ${installed ?? '(unknown)'} → ${release.tag_name}…`)
  const binaryName = await installBinaryFromRelease(release, suffix)
  console.log(`Upgraded to ${release.tag_name} (${binaryName}) at ${targetBin}`)
}

const [, , subcommand] = process.argv

try {
  if (subcommand === 'version') {
    await cmdVersion()
  } else if (subcommand === 'upgrade') {
    await cmdUpgrade()
  } else {
    await cmdInstall()
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  // process.exitCode(非 process.exit)——在 fetch 用過之後呼叫
  // process.exit() 會在 Node 24 + Windows 上讓底層 libuv async handle
  // 來不及關閉就被強制終止,觸發原生斷言錯誤當掉整個程序(exit code
  // 127,不是預期的 1)。改寫入 exitCode 讓事件循環自然跑完,程序一樣
  // 會以非 0 結束,但不會在 fetch 之後崩潰。
  process.exitCode = 1
}
