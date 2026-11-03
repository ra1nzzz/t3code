import fs from 'node:fs'

const BASE = 'http://127.0.0.1:9222'

const command = process.argv[2]

async function targets() {
  const res = await fetch(`${BASE}/json/list`)
  return res.json()
}

function pick(list) {
  const appPage = list.find((t) => t.type === 'page' && /^[a-z][a-z0-9-]*:\/\/app/.test(t.url) && !t.url.startsWith('devtools'))
  if (!appPage) throw new Error('no app page target yet: ' + list.map((t) => `${t.type}:${t.url}`).join(' | '))
  return appPage
}

async function cdp(fn) {
  const page = pick(await targets())
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true })
    ws.addEventListener('error', (e) => j(new Error('ws error ' + e.message)), { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id
      pending.set(n, (msg) => resolve(msg.result ?? msg.error))
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  try {
    return await fn(send, page)
  } finally {
    ws.close()
  }
}

const EVAL_EXPR = `(() => {
  const SKIP = 'code,pre,textarea,input,script,style,select,option,noscript,xmp'
  const out = { text: [], attrs: {}, regions: [] }
  const isVisible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }
  const seenText = new Set()
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = tw.nextNode())) {
    const raw = n.nodeValue
    if (!raw || !raw.trim()) continue
    const el = n.parentElement
    if (!el || el.closest(SKIP)) continue
    if (!isVisible(el)) continue
    const t = raw.replace(/\\s+/g, ' ').trim()
    if (!seenText.has(t)) { seenText.add(t); out.text.push({ t, tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 60) }) }
  }
  for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    if (!isVisible(el)) continue
    for (const a of ['placeholder', 'aria-label', 'title']) {
      const v = el.getAttribute(a)
      if (v && v.trim()) out.attrs[a + ':' + v.trim()] = el.tagName.toLowerCase()
    }
  }
  for (const el of document.querySelectorAll('[id],[data-testid],[data-conversation],[data-role]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 20) continue
    out.regions.push({
      id: el.id || null,
      testid: el.getAttribute('data-testid'),
      conv: el.getAttribute('data-conversation'),
      role: el.getAttribute('data-role'),
      tag: el.tagName.toLowerCase(),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    })
  }
  return { url: location.href, title: document.title, count: out.text.length, out }
})()`

if (command === 'reload') {
  await cdp(async (send) => {
    await send('Page.enable')
    await send('Page.reload', { ignoreCache: false })
    return 'reloaded'
  })
  console.log('reloaded')
} else if (command === 'dump') {
  const label = process.argv[3] ?? 'main'
  const r = await cdp(async (send) => {
    const res = await send('Runtime.evaluate', { expression: EVAL_EXPR, returnByValue: true, awaitPromise: true })
    return res
  })
  if (r.exceptionDetails) {
    console.error('eval error', JSON.stringify(r.exceptionDetails).slice(0, 400))
    process.exit(1)
  }
  const v = r.result?.value
  fs.writeFileSync(`harvest/dom-${label}.json`, JSON.stringify(v, null, 1))
  console.log(`${label}: ${v.count} visible text nodes, url=${v.url}`)
} else if (command === 'shot') {
  const file = process.argv[3] ?? 'shot.png'
  const r = await cdp((send) => send('Page.captureScreenshot', { format: 'png' }))
  if (r.data) {
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    console.log('wrote ' + file)
  } else console.error('screenshot failed', JSON.stringify(r).slice(0, 300))
} else if (command === 'screens') {
  const routes = (process.argv[3] ?? '')
    .split(',')
    .filter(Boolean)
    .map((r) => (r.startsWith('/') ? r : '/' + r))
  const wait = Number(process.argv[4] ?? 1500)
  await cdp(async (send) => {
    for (const r of routes) {
      await send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify('#' + r)}` })
      await new Promise((res) => setTimeout(res, wait))
      const out = await send('Runtime.evaluate', { expression: EVAL_EXPR, returnByValue: true })
      const v = out.result?.value
      if (!v) {
        console.log(`${r}: FAILED ${JSON.stringify(out).slice(0, 160)}`)
        continue
      }
      const name = r.replace(/[^a-z0-9]+/gi, '_')
      fs.writeFileSync(`harvest/dom-${name}.json`, JSON.stringify(v, null, 1))
      console.log(`${r}: ${v.count}`)
    }
    return null
  })
} else if (command === 'click') {
  const sel = process.argv[3]
  const r = await cdp((send) =>
    send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'not found'; el.click(); return 'clicked ' + (el.textContent || '').trim().slice(0, 40) })()`,
      returnByValue: true,
    }),
  )
  console.log(JSON.stringify(r.result?.value ?? r))
} else if (command === 'js') {
  const expr = fs.readFileSync(process.argv[3], 'utf8')
  const r = await cdp((send) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
  console.log(JSON.stringify(r.result?.value ?? r.error ?? r, null, 1).slice(0, 4000))
} else {
  const list = await targets().catch(() => [])
  console.log(list.map((t) => `${t.type}\t${t.url}\t${t.title ?? ''}`).join('\n'))
}
