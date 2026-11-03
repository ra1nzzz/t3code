(cfg) => {
  const state = { installed: true, misses: new Map(), hints: new Map(), passes: 0 }
  window.__zhHans = state
  const dict = cfg.dict || {}
  const patterns = (cfg.patterns || []).map(([source, target]) => [new RegExp(source, "u"), target])
  const attrNames = cfg.attrs || ["placeholder", "title", "aria-label"]
  const skipSelector = (cfg.skip || []).join(",")
  const attrSkipSelector = (cfg.attrSkip || cfg.skip || []).join(",")
  const last = new WeakMap()

  const isCodeish = (s) => /^[\x00-\x7F]*$/.test(s) === false || /^(git|npm|pnpm|npx|t3|cd|ls|cat|grep|sudo|curl|ssh)\s/.test(s)

  const lookup = (key, depth) => {
    const exact = dict[key]
    if (typeof exact === "string") return exact
    if (depth === undefined || depth < 3) {
      for (const [re, to] of patterns) {
        const m = key.match(re)
        if (!m) continue
        return to.replace(/\$(\d+)/g, (_, group) => {
          const inner = m[Number(group)]
          if (inner === undefined) return ""
          const translated = lookup(inner, (depth || 1))
          return translated === null ? inner : translated
        })
      }
    }
    return null
  }

  const skippable = (el) => !!skipSelector && !!el && !!el.closest && el.closest(skipSelector) !== null

  const skippableAttr = (el) => !!attrSkipSelector && !!el && !!el.closest && el.closest(attrSkipSelector) !== null

  const translateText = (node) => {
    const raw = node.nodeValue
    if (!raw || !raw.trim()) return
    const el = node.parentElement
    if (!el || skippable(el)) return
    if (last.get(node) === raw) return
    const key = raw.replace(/\s+/g, " ").trim()
    if (!key) return
    const out = lookup(key)
    if (out !== null) {
      last.set(node, out)
      node.nodeValue = out
      return
    }
    last.set(node, raw)
    if (key.length > 2 && key.length < 80 && /^[A-Z]/.test(key) && key.split(" ").length <= 10 && !isCodeish(key)) {
      state.misses.set(key, (state.misses.get(key) || 0) + 1)
      if (!state.hints.has(key)) {
        const cls = (el.getAttribute && el.getAttribute("class")) || ""
        let html = ""
        try {
          html = (el.outerHTML || "").replace(/\s+/g, " ").slice(0, 160)
        } catch {}
        state.hints.set(key, el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/)[0] : "") + " | " + html)
      }
    }
  }

  const translateAttrs = (el) => {
    if (!el || el.nodeType !== 1 || skippableAttr(el)) return
    for (const name of attrNames) {
      const value = el.getAttribute && el.getAttribute(name)
      if (!value || !value.trim()) continue
      if (last.get(el) === name + "=" + value) continue
      const out = lookup(value.replace(/\s+/g, " ").trim())
      if (out !== null) {
        last.set(el, name + "=" + out)
        el.setAttribute(name, out)
      } else {
        last.set(el, name + "=" + value)
        const key = value.replace(/\s+/g, " ").trim()
        if (key.length > 2 && key.length < 80 && /^[A-Z]/.test(key) && key.split(" ").length <= 10 && !isCodeish(key)) {
          state.misses.set(key, (state.misses.get(key) || 0) + 1)
          if (!state.hints.has(key)) state.hints.set(key, "@" + name + " " + el.tagName.toLowerCase())
        }
      }
    }
  }

  const pass = () => {
    state.passes++
    if (!document.body) return
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let n
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) translateText(n)
      else translateAttrs(n)
    }
  }

  let queued = false
  const run = () => {
    if (!queued) return
    queued = false
    pass()
  }
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
    setTimeout(run, 150)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: attrNames,
  })

  setInterval(() => {
    const top = [...state.misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400)
    const payload = JSON.stringify(top.map(([s, n]) => [s, n, state.hints.get(s) || ""]))
    if (payload === state.lastReported) return
    if (payload === "[]" && state.lastReported === undefined && state.passes < 3) return
    state.lastReported = payload
    console.log("[zh-miss]" + payload)
  }, 4000)

  pass()
}
