# T3 Code 简体中文汉化（运行时覆盖层）

给 T3 Code 桌面版加一层简体中文界面。不改前端源码、不重新构建应用，只在主进程注入一段脚本，用词典在 DOM 层替换界面文本，并翻译原生菜单。

在 `0.1.3-nightly.20261023.3553`（Electron 44, Windows x64）上验证通过。词典按精确文本匹配，界面文案变化只会让对应词条失效，不会破坏功能。

## 目录

```
localization/
  install.mjs        给安装包打补丁（解包 → 注入 → 重打包 → 逐条校验 → 应用）
  dict.mjs           词典构建器（拆分 / 合并 / 安装）
  cdp.mjs            通过调试端口采集真实渲染文本
  find-gaps.mjs      列出采集结果里仍未翻译的字符串
  analyze-coverage.mjs
  test-lookup.mjs    检查某个字符串会被译成什么
  zh-hans/
    config.json      skip 规则、正则模板、原生菜单映射
    overlay.js       渲染层翻译引擎
    main-hook.js     主进程注入脚本（被前置到 main.cjs）
    messages.json    构建产物 = config.json + dict/*.json
    dict/*.json      词条源文件，按界面区域分组
```

## 安装

1. 完全退出 T3 Code。
2. 在本目录执行 `npm install`。
3. 先干跑校验：`node install.mjs`。它会逐条比对重打包前后的文件清单与内容哈希，只有 `problems=0` 才继续。
4. 应用补丁：`node install.mjs --apply`。它会备份原文件、写入 `resources/zh-hans/`、把 `app-update.yml` 改名为 `app-update.yml.zh-bak` 以关闭自动更新，并清理 Electron 编译缓存。
5. 重新启动 T3 Code。

安装路径默认取 `C:/Users/<YOU>/AppData/Local/Programs/t3code`。其他位置用环境变量覆盖：

```bash
T3_INSTALL="D:/Programs/t3code" node install.mjs --apply
```

## 补词条

1. 编辑 `zh-hans/dict/` 下对应分组的 JSON，或改 `zh-hans/config.json` 里的 `patterns` / `menu` / `skip`。
2. 构建并写入安装目录：

   ```bash
   T3_ZH_LIVE="C:/Users/<YOU>/AppData/Local/Programs/t3code/resources/zh-hans/messages.json" \
     node dict.mjs build --install
   ```

3. 在应用里刷新页面（`Ctrl+R`）即可生效，不需要重新打补丁。

`dict/` 里多个文件出现同名键时，后加载的文件覆盖前者，构建时会打印 `override in ...`。

## 找出还缺哪些词条

- 自动回报：覆盖层每 4 秒把未命中的界面文本写到 `resources/zh-hans/missing.json`，`[]` 表示当前页面无缺口。
- 主动采集：用 `--remote-debugging-port=9222` 启动应用，然后

  ```bash
  node cdp.mjs screens "settings/general,settings/providers,threads" 2400
  node find-gaps.mjs
  ```

  路由参数不要带前导 `/`，MSYS/Git-Bash 会改写这类参数。

调试端口只用于采集，日常使用请正常启动应用。

## 刻意不翻译

- 代码块、行内代码、终端、输入框与用户自己的会话内容。
- 文件路径、进程命令行、堆栈、遥测标识、keybinding 的 when 表达式。
- 模型名、提供商名、品牌名。

保护方式有两层：`config.json` 的 `skip` / `attrSkip` 选择器，以及词典里的同名恒等词条（例如 `"BitbucketApi.responseError": "BitbucketApi.responseError"`）。

## 回滚

退出应用后，把 `resources/` 下的备份改回原名，并删除 `resources/zh-hans/`：

```
app.asar.zh-bak          -> app.asar
app.asar.unpacked.zh-bak -> app.asar.unpacked
app-update.yml.zh-bak    -> app-update.yml
```

## 说明

- 这是非官方补丁。应用自更新已关闭；升级版本后需对新安装包重新执行一次 `install.mjs`。
- 补丁只作用于桌面端主进程，服务器端与网页端不在范围内。
