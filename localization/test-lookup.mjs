import fs from 'node:fs'
const m = JSON.parse(fs.readFileSync(process.env.T3_ZH_LIVE || 'zh-hans/messages.json', 'utf8'))
const dict = m.dict
const pats = m.patterns.map(([s, t]) => [new RegExp(s, 'u'), t])
const lookup = (key, depth) => {
  const exact = dict[key]
  if (typeof exact === 'string') return exact
  if (depth === undefined || depth < 3) {
    for (const [re, to] of pats) {
      const mm = key.match(re)
      if (!mm) continue
      return to.replace(/\$(\d+)/g, (_, g) => {
        const inner = mm[Number(g)]
        if (inner === undefined) return ''
        const tr = lookup(inner, depth || 1)
        return tr === null ? inner : tr
      })
    }
  }
  return null
}
// Edit the list below to check how the dictionary resolves a string.
for (const k of ['Worked for 1m 36s', '11h ago', 'Toggle right panel (Ctrl+Alt+B)', 'New thread in My Project']) {
  console.log(JSON.stringify(k), '=>', JSON.stringify(lookup(k)))
}
