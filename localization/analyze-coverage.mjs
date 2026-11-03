import fs from 'node:fs'

const messages = JSON.parse(fs.readFileSync('zh-hans/messages.json', 'utf8'))
const dictKeys = new Set(Object.keys(messages.dict || {}))

const files = fs.readdirSync('harvest').filter((f) => /^dom-(_|\/)?.*\.json$/.test(f) && !f.includes('prepatch'))
const SKIP_TAG = new Set(['code', 'pre', 'kbd', 'samp'])
const counts = new Map()
const where = new Map()

const isProbablyUiEnglish = (t) => {
  if (/[\u4e00-\u9fff]/.test(t)) return false
  if (t.length < 3 || t.length > 90) return false
  if (!/^[A-Za-z]/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length > 12) return false
  // must contain at least 2 letters total and mostly letters/spaces/punct
  if (!/[A-Za-z]{3,}/.test(t)) return false
  // exclude technical noise
  if (/[\\/]/.test(t)) return false
  if (/\b[\w-]+\.(js|ts|tsx|json|md|css|html|png|jpg|svg|exe|dll|node|mjs|cjs|yar|gz)\b/i.test(t)) return false
  if (/^\d/.test(t)) return false
  if (/^v?\d+(\.\d+)+/.test(t)) return false
  if (/[:：]/.test(t) && !/\s/.test(t)) return false
  if (/\b\d+(\.\d+)?\s*(ms|s|m|h|d|kb|mb|gb|%|x)\b/i.test(t)) return false
  if (/^[A-Z]{1,4}$/.test(t)) return false
  if (/^[A-Z][a-z]+\+[A-Z]/.test(t)) return false
  return true
}

for (const f of files) {
  let j
  try {
    j = JSON.parse(fs.readFileSync('harvest/' + f, 'utf8'))
  } catch {
    continue
  }
  const route = (j.url || f).replace(/^.*#/, '') || f
  for (const item of (j.out && j.out.text) || []) {
    if (SKIP_TAG.has(item.tag)) continue
    const t = item.t
    if (dictKeys.has(t)) continue
    if (!isProbablyUiEnglish(t)) continue
    counts.set(t, (counts.get(t) || 0) + 1)
    if (!where.has(t)) where.set(t, [])
    where.get(t).push(route)
  }
  for (const key of Object.keys((j.out && j.out.attrs) || {})) {
    const i = key.indexOf(':')
    const v = key.slice(i + 1)
    if (dictKeys.has(v)) continue
    if (!isProbablyUiEnglish(v)) continue
    counts.set(v, (counts.get(v) || 0) + 1)
    if (!where.has(v)) where.set(v, [])
    where.get(v).push(route + ' [attr]')
  }
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
console.log('candidate untranslated strings: ' + sorted.length)
console.log('screens scanned: ' + files.length)
for (const [t, n] of sorted) {
  console.log(String(n).padStart(3) + '  ' + t.padEnd(52) + ' ' + [...new Set(where.get(t))].slice(0, 2).join(','))
}
