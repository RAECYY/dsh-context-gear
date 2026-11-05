# @deepseek-ai/dsh-context-gear

**English** | [中文](#中文)

A DeepSeek Harness (DSH) plugin that adds a compact **压缩** button inside the chat composer tool row. Long conversations silently consume the model's context window and degrade reply quality — this plugin lets you pick a token tier (200k / 300k / 500k / 800k / 1M) and, with one click on **应用并压缩**, trigger one `/compact` through the built-in `dsh-compaction-basic` engine: older history is condensed into a structured summary while system prompts and recent turns stay verbatim, freeing context space without breaking the KV cache. The 5 tiers each ship with a copyable Chinese "soft prompt" describing how aggressively the summary should compress — for manual pasting only, never auto-injected. It is a **pure scheduler**: it never summarizes by itself, and it never reads or rewrites conversation messages.

Verified against **DSH 0.2.1-rc.5** (Desktop); compatible with **0.2.0-rc.2+**.

---

## Install (for users)

### Requirements

- DeepSeek Harness **0.2.0-rc.2 or later** (tested on 0.2.1-rc.5 Desktop)
- The compression backend `@deepseek-ai/dsh-compaction-basic` and `@deepseek-ai/dsh-command-compact` are **built into DSH** — no extra install needed.

### Step 1 — Install from the plugin page (GUI only)

> ⚠️ **The `dsh` CLI cannot manage the desktop profile** — it is owned exclusively by the Electron app. You must install through the Desktop GUI.

1. Open DSH Desktop, click **Plugins** in the left sidebar.
2. Click **Add plugin**, paste this into the input box:

   ```
   github:RAECYY/dsh-context-gear
   ```

3. Click **Install**. The manager checks the repo, pulls it with pnpm, and enables it by default.
4. If HMR is on, it applies immediately; otherwise restart the profile when prompted.

### Step 2 — Verify

A compact **压缩 button** appears **inside the composer tool row** (left side, beside the attach/plan controls). Click it to open a floating panel:

| Control | Behavior |
| --- | --- |
| **Gear button + occupancy dot** | Sits in the composer tool row; the colored dot shows context occupancy (same `contextPressure` projection the built-in 上下文医生/context-doctor uses). Click to open the panel. |
| **Tier rows** | Inside the panel: 200k / 300k / 500k / 800k / 1M, each row shows **"压到 X · 保留 Y"** (e.g. 300k → 压到 300k · 保留 90k). Default **300k**. Click to switch. Any tier whose target **exceeds the current model's context window** is disabled and labeled "超出本模型上下文上限"; if the saved tier is over the cap, it auto-downgrades to the highest valid tier. |
| **应用并压缩** | Applies the tier to the compaction engine, then triggers one `/compact`. Disabled with "压缩中…" while in flight. |
| **复制软提示** | Copies the tier's soft prompt to the clipboard for manual paste. **Never** written into the conversation automatically. |
| **自动压缩** checkbox | 75%-threshold automatic compaction. Default **on**. |
| Hover tooltips | Every control shows a native hover tooltip — the gear button explains occupancy; each tier row spells out exactly how much it compresses and retains; **应用并压缩** spells out it triggers one `/compact` for *this conversation only*. |

The panel keeps every explanation the old strip had — nothing was dropped — while the composer stays clean (just one small button at rest).

State (`tier` + `auto`) persists per session in `localStorage` under `dsh-context-gear:<sessionId>`.

## Update

When a new version is pushed to GitHub: open the **Plugins** page, find `dsh-context-gear`, click **Update**. The manager uninstalls the old version first, then installs the new one; without HMR you will be prompted to restart.

## Tier → engine policy

| Tier | maxTokens | retainTokens | thresholdRatio |
| --- | --- | --- | --- |
| 200k | 200000 | 60000 | 0.75 |
| 300k | 300000 | 90000 | 0.75 |
| 500k | 500000 | 150000 | 0.75 |
| 800k | 800000 | 240000 | 0.75 |
| 1M | 1000000 | 300000 | 0.75 |

## ⚠️ Known limitations

1. The plugin only **schedules** `dsh-compaction-basic`; it **cannot modify the engine's internal summary prompt**. Soft prompts are copy-only and never auto-injected.
2. The `auto` toggle is **global** (all sessions), not per-session.
3. The engine's config is frozen at load time (`deepFreeze`), so the tier's `maxTokens`/`retainTokens` are advisory; the actual ceiling is governed by your model's `contextWindow`. The **`/compact` trigger itself always works**.
4. The plugin **never mutates conversation messages** (protects the KV cache).

## License

Free for **non-commercial use only**, no modification, no redistribution — see [LICENSE.txt](LICENSE.txt). Sharing the repo link is welcome.

---

# 中文

一个 DeepSeek Harness (DSH) 插件，在聊天输入框工具行内提供一个紧凑的「压缩」按钮。对话越来越长会悄悄占满模型的上下文窗口、导致回答质量下降——本插件让你选择一个 token 档位（200k / 300k / 500k / 800k / 1M），点一下 **应用并压缩**，就通过内置 `dsh-compaction-basic` 引擎触发一次 `/compact`：久远历史被浓缩成结构化摘要，系统提示与最近几轮原样保留，在不破坏 KV 缓存的前提下腾出上下文空间。5 个档位各附带一份可复制的中文「软提示」，描述该档位摘要的压缩力度——仅供手动粘贴，绝不自动注入。**本插件只做调度**：不自己实现摘要，也绝不读取或改写会话消息。

已针对 **DSH 0.2.1-rc.5**（Desktop）验证；兼容 **0.2.0-rc.2 及以上**。

---

## 安装（使用者）

### 前提条件

- DeepSeek Harness **0.2.0-rc.2 或更高**（在 0.2.1-rc.5 Desktop 上测试通过）
- 压缩后端 `@deepseek-ai/dsh-compaction-basic` 与 `@deepseek-ai/dsh-command-compact` 为 **DSH 内置**，无需额外安装。

### 第 1 步 — 通过插件页安装（仅限图形界面）

> ⚠️ **`dsh` 命令行无法管理 desktop profile** —— 它由 Electron 应用独占。必须通过桌面端图形界面安装。

1. 打开 DSH 桌面端，点击左侧边栏的 **插件** 页。
2. 点击 **添加插件**，在输入框粘贴：

   ```
   github:RAECYY/dsh-context-gear
   ```

3. 点击 **安装**。插件管理器会检查仓库可达、用 pnpm 拉取，并默认启用。
4. 若开启了 HMR 立即生效；否则按提示重启 profile。

### 第 2 步 — 确认装好了

聊天输入框**工具行左侧**（附件、计划按钮旁边）会出现一个紧凑的**「压缩」按钮**。点击它弹出浮层：

| 控件 | 行为 |
| --- | --- |
| **齿轮按钮 + 占用圆点** | 位于输入框工具行内；彩色圆点显示上下文占用（与内置「上下文医生」context-doctor 同一套 `contextPressure` 投影）。点击展开面板。 |
| **档位行** | 面板内：200k / 300k / 500k / 800k / 1M，每行显示**「压到 X · 保留 Y」**（如 300k → 压到 300k · 保留 90k）。默认 **300k**。点击切换。**凡压到目标超过当前模型上下文窗口的档位会被禁用并标注「超出本模型上下文上限」**；若已保存的档位超上限，面板会自动降级到不超上限的最高档位。 |
| **应用并压缩** | 把档位写入压缩引擎并触发一次 `/compact`。执行中显示"压缩中…"并置灰。 |
| **复制软提示** | 复制该档位软提示到剪贴板，供手动粘贴。**绝不**自动写入对话。 |
| **自动压缩** 复选框 | 75% 阈值自动压缩，默认 **开**。 |
| **悬停提示** | 每个控件都有原生解释——齿轮按钮说明占用；每个档位行写明压多少/留多少；「应用并压缩」清楚说明：它把档位写入引擎并触发一次 `/compact`，且**只作用于当前这一个对话**。 |

面板保留了全部说明（档位、压到/保留数字、应用并压缩只作用于当前对话、复制软提示），一条不少；而输入框平时只多一个小按钮，干净不占地方。

状态（`tier` + `auto`）按会话持久化在 `localStorage` 的 `dsh-context-gear:<sessionId>` 下。

## 更新

作者推送新版本后：打开 **插件** 页，找到 `dsh-context-gear`，点 **更新**。管理器先卸载旧版再安装新版；未开启 HMR 时会提示重启。

## 档位 → 引擎策略

| 档位 | maxTokens | retainTokens | thresholdRatio |
| --- | --- | --- | --- |
| 200k | 200000 | 60000 | 0.75 |
| 300k | 300000 | 90000 | 0.75 |
| 500k | 500000 | 150000 | 0.75 |
| 800k | 800000 | 240000 | 0.75 |
| 1M | 1000000 | 300000 | 0.75 |

## ⚠️ 已知限制

1. 本插件仅**调度** `dsh-compaction-basic`，**无法修改引擎内部摘要 prompt**。软提示仅支持手动复制，不会自动注入。
2. `auto` 自动压缩开关为**全局**，无法做到会话独立。
3. 引擎配置在加载时即被冻结（`deepFreeze`），档位的 `maxTokens`/`retainTokens` 属于参考值；真正的 token 上限由模型的 `contextWindow` 决定。但 **`/compact` 触发本身始终有效**。
4. 插件**绝不改动会话消息**（保护 KV 缓存）。

## 许可

仅限**非商业用途**自由使用，**禁止修改、禁止再分发** —— 详见 [LICENSE.txt](LICENSE.txt)。欢迎分享本仓库链接。

---

## 仓库结构 / Repo layout

```
dsh-context-gear/
├── package.json        # dsh bundle + client manifest, exports ./client
├── cordis.patch.yml    # bundle patch (registers the host row)
├── host.ts / lib/index.js        # host half: command context-gear-apply
├── client.tsx / lib/client.js    # browser half: 输入框工具行内的「压缩」按钮 + 浮层面板（样式内联在 client.tsx 的 STYLE_TEXT）
├── lib/types/index.d.ts          # 共享类型声明
├── src/dsh-shims.d.ts            # DSH 宿主模块类型垫片（仅类型）
├── _transpile.cjs / _validate.cjs / _smoke.cjs  # 本地构建与校验脚本（不打包进插件）
├── LICENSE.txt         # 使用许可（可使用，禁改禁发）
└── README.md
```

**开发者本地构建**（改 TS 后重新生成 `lib/`）：

```sh
npm run build    # TS -> lib/index.js + lib/client.js（类型剥离）
npm run smoke    # 冒烟测试
npm run validate # 静态校验
```
