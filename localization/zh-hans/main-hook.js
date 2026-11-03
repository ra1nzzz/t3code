;(() => {
  "use strict"
  const zhFs = require("node:fs")
  const zhPath = require("node:path")
  const zhEl = require("electron")
  const zhDir = zhPath.join(process.resourcesPath, "zh-hans")

  const zhReadText = (name) => {
    try {
      return zhFs.readFileSync(zhPath.join(zhDir, name), "utf8")
    } catch {
      return null
    }
  }
  const zhConfig = () => {
    const raw = zhReadText("messages.json")
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  const zhAppUrl = (url) => /^(t3code|app):\/\//i.test(url)

  const zhInject = (contents) => {
    try {
      if (!contents || contents.isDestroyed()) return
      if (!zhAppUrl(contents.getURL())) return
      const overlay = zhReadText("overlay.js")
      const config = zhConfig()
      if (!overlay || !config) return
      contents
        .executeJavaScript("window.__zhHans && window.__zhHans.installed || (" + overlay + ")(" + JSON.stringify(config) + ")")
        .catch(() => {})
    } catch {}
  }

  const zhTranslateMenu = (menu) => {
    try {
      const config = zhConfig()
      if (!config || !menu || !Array.isArray(menu.items)) return
      const labels = config.menu || {}
      const walk = (items) => {
        for (const item of items) {
          if (!item) continue
          if (Array.isArray(item.items)) walk(item.items)
          const roleKey = item.role ? "@" + item.role : null
          const labelKey = item.label ? "!" + item.label : null
          const next = (roleKey && labels[roleKey]) || (labelKey && labels[labelKey])
          if (next) item.label = next
        }
      }
      walk(menu.items)
    } catch {}
  }

  try {
    const original = zhEl.Menu.setApplicationMenu.bind(zhEl.Menu)
    zhEl.Menu.setApplicationMenu = (menu) => {
      zhTranslateMenu(menu)
      return original(menu)
    }
    const originalPopup = zhEl.Menu.prototype.popup
    zhEl.Menu.prototype.popup = function (...args) {
      zhTranslateMenu(this)
      return originalPopup.apply(this, args)
    }
  } catch {}

  try {
    zhEl.app.on("web-contents-created", (_event, contents) => {
      try {
        contents.on("dom-ready", () => zhInject(contents))
        contents.on("did-frame-finish-load", () => zhInject(contents))
        contents.on("console-message", (...args) => {
          const message = typeof args[1] === "string" ? args[1] : args[0] && args[0].message
          if (typeof message !== "string" || !message.startsWith("[zh-miss]")) return
          try {
            zhFs.writeFileSync(zhPath.join(zhDir, "missing.json"), message.slice(9))
          } catch {}
        })
      } catch {}
    })
  } catch {}
})()
