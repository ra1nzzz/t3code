import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1')
const ZH = path.join(HERE, 'zh-hans')
const DICT = path.join(ZH, 'dict')
const LIVE = process.env.T3_ZH_LIVE || 'C:/Users/<YOU>/AppData/Local/Programs/t3code/resources/zh-hans/messages.json'
const cmd = process.argv[2]

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

if (cmd === 'split') {
  const m = readJson(path.join(ZH, 'messages.json'))
  const { dict, ...config } = m
  fs.writeFileSync(path.join(ZH, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  fs.mkdirSync(DICT, { recursive: true })
  fs.writeFileSync(path.join(DICT, '01-core.json'), JSON.stringify(dict, null, 2) + '\n')
  console.log(`split: config keys=${Object.keys(config).join(',')} dict=${Object.keys(dict).length}`)
} else if (cmd === 'build') {
  const config = readJson(path.join(ZH, 'config.json'))
  const files = fs.readdirSync(DICT).filter((f) => f.endsWith('.json')).sort()
  const dict = {}
  for (const f of files) {
    const part = readJson(path.join(DICT, f))
    for (const [k, v] of Object.entries(part)) {
      if (k in dict && dict[k] !== v) console.log(`override in ${f}: ${k}`)
      dict[k] = v
    }
  }
  const sorted = Object.fromEntries(Object.entries(dict).sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0])))
  const out = { ...config, dict: sorted }
  const text = JSON.stringify(out, null, 1) + '\n'
  fs.writeFileSync(path.join(ZH, 'messages.json'), text)
  if (cmd === 'build' && process.argv.includes('--install')) {
    fs.writeFileSync(LIVE, text)
    fs.copyFileSync(path.join(ZH, 'overlay.js'), path.join(path.dirname(LIVE), 'overlay.js'))
    console.log('synced messages.json + overlay.js to install dir')
  }
  console.log(`built messages.json: ${Object.keys(sorted).length} entries, ${files.length} dict files, ${text.length} bytes`)
} else {
  console.log('usage: node dict.mjs split | build [--install]')
}
