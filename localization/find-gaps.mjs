import fs from 'node:fs'

const live = JSON.parse(fs.readFileSync(process.env.T3_ZH_LIVE || 'zh-hans/messages.json', 'utf8'))
const dict = live.dict
const pats = (live.patterns || []).map((p) => new RegExp(p[0], 'u'))

const isEng = (s) => s && /[A-Za-z]{3}/.test(s) && /^[\x00-\x7F]+$/.test(s)
const covered = (s) => dict[s] !== undefined || pats.some((r) => r.test(s))

const files = fs.readdirSync('harvest').filter((f) => f.startsWith('dom-') && f.endsWith('.json'))
const out = new Map()
for (const f of files) {
  const j = JSON.parse(fs.readFileSync('harvest/' + f, 'utf8'))
  const label = (j.url || '').replace('t3code://app#/', '')
  const arr = [
    ...(j.out.text || []).map((e) => e.t),
    ...Object.keys(j.out.attrs || {})
      .filter((k) => k.startsWith('title:') || k.startsWith('placeholder:') || k.startsWith('aria-label:'))
      .map((k) => k.slice(k.indexOf(':') + 1)),
  ]
  for (const s of arr) {
    if (isEng(s) && !covered(s)) {
      if (!out.has(s)) out.set(s, new Set())
      out.get(s).add(label)
    }
  }
}
const rows = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log('UNTRANSLATED VISIBLE STRINGS: ' + rows.length)
for (const [s, ls] of rows) console.log(`[${[...ls].join(',')}] ${JSON.stringify(s)}`)
