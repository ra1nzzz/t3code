import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

const asar = createRequire(import.meta.url)('@electron/asar')

const INSTALL = process.env.T3_INSTALL || 'C:/Users/<YOU>/AppData/Local/Programs/t3code'
const RES = path.join(INSTALL, 'resources')
const ORIG = path.join(RES, 'app.asar')
const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1')
const WORK = path.join(HERE, 'work')
const SRC = path.join(WORK, 'extracted')
const NEW = path.join(WORK, 'app.asar')
const PATCHED = path.join('apps', 'desktop', 'dist-electron', 'main.cjs')
const APPLY = process.argv.includes('--apply')

const fail = (m) => {
  console.error('ABORT: ' + m)
  process.exit(1)
}

const shaFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const unpackGlob = '**/{*.node,*.exe,main.cjs}'

const headerWalk = (node, prefix, out) => {
  for (const name of Object.keys(node.files)) {
    const child = node.files[name]
    const p = prefix ? prefix + '/' + name : name
    if (child.files) {
      out.push({ path: p, kind: 'dir', unpacked: false })
      headerWalk(child, p, out)
    } else if (typeof child.link === 'string') {
      out.push({ path: p, kind: 'link', unpacked: false })
    } else {
      out.push({ path: p, kind: 'file', unpacked: child.unpacked === true })
    }
  }
}
const readHeader = (archive) => {
  const out = []
  headerWalk(JSON.parse(asar.getRawHeader(archive).headerString), '', out)
  return out
}
const treeWalk = (root, prefix, out) => {
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const rel = prefix ? prefix + '/' + name : name
    const st = fs.statSync(path.join(root, rel))
    if (st.isDirectory()) {
      out.push({ path: rel, kind: 'dir' })
      treeWalk(root, rel, out)
    } else out.push({ path: rel, kind: st.isSymbolicLink() ? 'link' : 'file' })
  }
  return out
}

// ---------- 1. extract original ----------
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
asar.extractAll(ORIG, SRC)
const origEntries = treeWalk(SRC, '', [])
console.log(`extracted original: ${origEntries.length} entries`)

// ---------- 2. patch ----------
const mainPath = path.join(SRC, PATCHED)
if (!fs.existsSync(mainPath)) fail('main.cjs missing from extracted tree')
const hook = fs.readFileSync(path.join(HERE, 'zh-hans/main-hook.js'), 'utf8')
const originalMain = fs.readFileSync(mainPath)
fs.writeFileSync(mainPath, Buffer.concat([Buffer.from(hook, 'utf8'), Buffer.from('\n'), originalMain]))
console.log(`main.cjs ${originalMain.length} -> ${fs.statSync(mainPath).size} bytes`)

// ---------- 3. repack ----------
await asar.createPackageWithOptions(SRC, NEW, { unpack: unpackGlob })
console.log(`repacked: ${fs.statSync(NEW).size} bytes (original ${fs.statSync(ORIG).size})`)

// ---------- 4. verify: entry set + content ----------
const newExtractDir = path.join(WORK, 'verify')
fs.mkdirSync(newExtractDir, { recursive: true })
asar.extractAll(NEW, newExtractDir)
const newEntries = treeWalk(newExtractDir, '', [])

let problems = 0
const newByPath = new Map(newEntries.map((e) => [e.path, e.kind]))
for (const e of origEntries) {
  const kind = newByPath.get(e.path)
  if (!kind) {
    console.error('MISSING: ' + e.path)
    problems++
    continue
  }
  if (kind !== e.kind) {
    console.error('KIND CHANGED: ' + e.path)
    problems++
    continue
  }
  if (kind !== 'file') continue
  if (e.path === PATCHED.split(path.sep).join('/')) continue
  if (shaFile(path.join(SRC, e.path)) !== shaFile(path.join(newExtractDir, e.path))) {
    console.error('CONTENT DIFFERS: ' + e.path)
    problems++
  }
}
for (const e of newEntries) {
  if (!origEntries.some((o) => o.path === e.path)) {
    console.error('EXTRA: ' + e.path)
    problems++
  }
}
const patchedNew = fs.readFileSync(path.join(newExtractDir, PATCHED))
if (!patchedNew.subarray(0, hook.length).equals(Buffer.from(hook))) fail('hook is not at the head of the packed main.cjs')
if (!patchedNew.subarray(hook.length + 1).equals(originalMain)) fail('main.cjs tail differs from the original bytes')

// unpacked set must be exactly the natives + main.cjs
const wantUnpacked = new Set(
  readHeader(ORIG)
    .filter((e) => e.unpacked)
    .map((e) => e.path),
)
wantUnpacked.add(PATCHED.split(path.sep).join('/'))
const gotUnpacked = new Set(readHeader(NEW).filter((e) => e.unpacked).map((e) => e.path))
for (const p of wantUnpacked) if (!gotUnpacked.has(p)) console.error('NOT UNPACKED: ' + p)
for (const p of gotUnpacked) if (!wantUnpacked.has(p)) console.error('UNEXPECTEDLY UNPACKED: ' + p)
problems += wantUnpacked.size - [...wantUnpacked].filter((p) => gotUnpacked.has(p)).length
problems += gotUnpacked.size - [...gotUnpacked].filter((p) => wantUnpacked.has(p)).length

console.log(`verify: ${origEntries.length} entries compared, problems=${problems}`)
if (problems) fail('rebuilt archive is not equivalent')
console.log('unpacked entries: ' + [...gotUnpacked].join(', '))

// ---------- 5. apply ----------
if (!APPLY) {
  console.log('\nDRY RUN ok. Re-run with --apply to install.')
} else {
  const running = execSync(
    'powershell -NoProfile -Command "(Get-Process | Where-Object { $_.ProcessName -like \'*T3 Code*\' }).Count"',
    { encoding: 'utf8' },
  ).trim()
  if (running !== '0') fail('T3 Code is running (' + running + ' processes) — quit it before --apply')

  const bak = ORIG + '.zh-bak'
  const bakUnpacked = ORIG + '.unpacked.zh-bak'
  if (!fs.existsSync(bak)) fs.copyFileSync(ORIG, bak)
  if (fs.existsSync(ORIG + '.unpacked') && !fs.existsSync(bakUnpacked)) fs.renameSync(ORIG + '.unpacked', bakUnpacked)
  fs.rmSync(ORIG + '.unpacked', { recursive: true, force: true })
  fs.copyFileSync(NEW, ORIG)
  fs.cpSync(NEW + '.unpacked', ORIG + '.unpacked', { recursive: true })
  fs.cpSync(path.join(HERE, 'zh-hans'), path.join(RES, 'zh-hans'), { recursive: true })

  const feed = path.join(RES, 'app-update.yml')
  if (fs.existsSync(feed) && !fs.existsSync(feed + '.zh-bak')) fs.renameSync(feed, feed + '.zh-bak')

  fs.rmSync(path.join(process.env.TEMP ?? '', 't3code', 'compile-cache'), { recursive: true, force: true })
  console.log('INSTALLED: patched asar + resources/zh-hans + update feed disabled + compile cache cleared')
}
