/**
 * @deepseek-ai/dsh-context-gear — Browser half.
 *
 * The composer tool row only hosts a compact "压缩" button with an occupancy
 * dot; clicking it opens a floating panel that holds the tier picker with
 * explicit "压到 X · 保留 Y" numbers, 应用并压缩, 复制软提示, 自动压缩, and
 * the occupancy readout. No explanations were dropped; they live in the panel
 * and in hover tooltips.
 *
 * The occupancy badge reads the SAME `contextPressure` projection the built-in
 * "上下文医生" (context-doctor) diagnosis plugin uses — same numbers (`pressureTokens` /
 * `projectedTokens` + `contextWindow`), so the two stay in sync: the doctor
 * diagnoses, this plugin acts.
 *
 * Per-session state (tier + auto) persists in localStorage under
 * `dsh-context-gear:<sessionId>`. Applying dispatches the host command
 * `context-gear-apply` via `ctx.remote.commands.execute`.
 */

// ---- soft prompts (mirrors host.ts; self-contained for the browser bundle) ----
const TIER_PROMPTS = {
  "200k": `【上下文压缩策略｜200k 紧凑档】
你是上下文摘要器。目标：压缩后总上下文控制在 200k token 以内，优先保护头部系统提示、角色设定、工具定义、MCP 配置不动，维持 KV 缓存有效。
规则：
1. 头部系统 / 角色 / 工具声明：原样保留，绝不修改、删减、重排。
2. 尾部最近 60k token 对话：完整保留原始内容，不做摘要。
3. 中间久远历史：提炼精简结构化摘要，只保留影响后续任务的关键结论、参数、已确认需求、约束条件、失败记录；省略闲聊、重复试错、中间思考过程。
4. 摘要格式：分点简洁，不冗余，不编造不存在的信息。
5. 本次档位上限严格 200k，优先保证关键信息，牺牲次要细节。`,
  "300k": `【上下文压缩策略｜300k 均衡档（默认）】
你是上下文摘要器。目标：压缩后总上下文控制在 300k token 以内，优先保护头部系统提示、角色设定、工具定义、MCP 配置不动，维持 KV 缓存有效。
规则：
1. 头部系统 / 角色 / 工具声明：原样保留，绝不修改、删减、重排。
2. 尾部最近 90k token 对话：完整保留原始内容，不做摘要。
3. 中间久远历史：提炼结构化摘要，保留重要决策、参数、方案、约束；删减反复调试、无效试错、重复确认。
4. 摘要条理清晰，不脑补信息。
5. 平衡信息完整度与 token 开销，日常微调首选。`,
  "500k": `【上下文压缩策略｜500k 宽裕档】
你是上下文摘要器。目标：压缩后总上下文控制在 500k token 以内，优先保护头部系统提示、角色设定、工具定义、MCP 配置不动，维持 KV 缓存有效。
规则：
1. 头部系统 / 角色 / 工具声明：原样保留，绝不修改、删减、重排。
2. 尾部最近 150k token 对话：完整保留原始内容，不做摘要。
3. 中间历史：摘要保留更多中间过程、备选方案、讨论细节，仅剔除无意义重复、闲聊。
4. 适合多方案对比、长流程设计，保留更多历史细节。`,
  "800k": `【上下文压缩策略｜800k 宽松档】
你是上下文摘要器。目标：压缩后总上下文控制在 800k token 以内，优先保护头部系统提示、角色设定、工具定义、MCP 配置不动，维持 KV 缓存有效。
规则：
1. 头部系统 / 角色 / 工具声明：原样保留，绝不修改、删减、重排。
2. 尾部最近 240k token 对话：完整保留原始内容，不做摘要。
3. 中间历史摘要可以保留大部分中间讨论、备选方案、推理过程，只剔除大量重复轮次。
4. 适合复杂长项目，尽量少丢失细节。`,
  "1M": `【上下文压缩策略｜1M 最大档】
你是上下文摘要器。目标：压缩后总上下文控制在 1000k token 以内，优先保护头部系统提示、角色设定、工具定义、MCP 配置不动，维持 KV 缓存有效。
规则：
1. 头部系统 / 角色 / 工具声明：原样保留，绝不修改、删减、重排。
2. 尾部最近 300k token 对话：完整保留原始内容，不做摘要。
3. 中间历史：摘要保留更多中间过程、备选方案、讨论细节，仅剔除无意义重复、闲聊。
4. 仅压缩非常久远的历史，尽可能保留全部项目脉络、方案、讨论记录。
5. 适合长期大项目、需要完整历史追溯，开销最高。`,
};

const TIERS = ["200k", "300k", "500k", "800k", "1M"];
const STORAGE_PREFIX = "dsh-context-gear:";
const DEFAULT_TIER = "300k";

// 档位策略（与 host.ts TIER_POLICY 一致）：maxTokens = 压缩后总上限；
// retainTokens = 尾部原样保留的 token 预算（近似最近 N 轮）。
const TIER_POLICY = {
  "200k": { maxTokens: 200000, retainTokens: 60000 },
  "300k": { maxTokens: 300000, retainTokens: 90000 },
  "500k": { maxTokens: 500000, retainTokens: 150000 },
  "800k": { maxTokens: 800000, retainTokens: 240000 },
  "1M": { maxTokens: 1000000, retainTokens: 300000 },
};

function formatK(n) {
  if (n < 1000000) return Math.round(n / 1000) + "k";
  const millions = n / 1000000;
  const whole = n % 1000000 === 0;
  return (whole ? millions.toFixed(0) : millions.toFixed(1)) + "M";
}

function readPersisted(sessionId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sessionId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.tier === "string" && TIERS.includes(parsed.tier)) {
        return { tier: parsed.tier, auto: typeof parsed.auto === "boolean" ? parsed.auto : true };
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return { tier: DEFAULT_TIER, auto: true };
}

function writePersisted(sessionId, tier, auto) {
  try {
    localStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify({ tier, auto }));
  } catch {
    /* storage may be unavailable; non-fatal */
  }
}

// ---- host-native toast (best-effort; falls back to an inline banner) ----
function showToast(ctx, message, kind) {
  try {
    const notifier = ctx && (ctx.toast || (ctx.notifications && ctx.notifications.show) || null);
    if (notifier && typeof notifier === "function") {
      notifier({ message, kind });
      return;
    }
  } catch {
    /* fall through to console + inline handled by caller */
  }
  if (kind === "error") console.warn("[context-gear] " + message);
  else console.info("[context-gear] " + message);
}

// ---- occupancy read ----
// Reads the SAME `contextPressure` projection (`pressure`) that the built-in
// 「上下文医生」(context-doctor) uses: `pressure.projectedTokens` is the
// next-request size and `pressure.contextWindow` is the live model window
// (NOT session.contextWindow — that field does not exist on the snapshot).
// Returns { ratio, total, contextWindow }.
function useOccupancy(props) {
  // 与内置 ContextMeter 完全同构：在组件渲染期同步读取 useProjection 这个
  // hook 返回的当前值。useProjection 本身是 React hook（官方 ContextMeter 就是
  // 在顶层直接 `useProjection("contextPressure")`），投影变化时由 React 自动
  // 重渲染，无需 useEffect / useState 缓存，也没有 .subscribe 这个 API。
  let pressure= undefined;
  try {
    const useProjection = props && props.useProjection;
    if (typeof useProjection === "function") pressure = useProjection("contextPressure");
  } catch {
    pressure = undefined;
  }
  const total = pressure && typeof pressure.projectedTokens === "number" ? pressure.projectedTokens
    : pressure && typeof pressure.pressureTokens === "number" ? pressure.pressureTokens : null;
  const ctxWin = pressure && typeof pressure.contextWindow === "number" ? pressure.contextWindow : null;
  let ratio= null;
  if (total != null && ctxWin && ctxWin > 0) ratio = Math.min(1, total / ctxWin);
  return { ratio, total, contextWindow: ctxWin };
}

// React 由 factory 顶层闭包提供（require 只存在于 factory 内部，
// 组件渲染在宿主 React 渲染器里执行，那里没有 require）。
let ReactRef= null;

// 齿轮图标（内联 SVG；primitives 打包在宿主内部，裸导入不可用）
const GEAR_SVG = "M11.398 2.083a1.5 1.5 0 0 1 2.06.548l.55.952a5.9 5.9 0 0 1 1.09.63l1.096-.233a1.5 1.5 0 0 1 1.682.876l.62 1.44a1.5 1.5 0 0 1-.42 1.744l-.854.72a6.2 6.2 0 0 1 0 1.28l.853.72a1.5 1.5 0 0 1 .42 1.743l-.62 1.44a1.5 1.5 0 0 1-1.681.877l-1.097-.233a5.9 5.9 0 0 1-1.09.63l-.55.952a1.5 1.5 0 0 1-2.06.548l-.998-.577a1.5 1.5 0 0 1-.75-1.299v-1.102a5.9 5.9 0 0 1 0-4.51V3.96c0-.537.287-1.033.75-1.3z M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z";

function ContextGearButton(props) {
  const React = ReactRef;
  const { sessionId, ctx } = props;
  const [open, setOpen] = React.useState(false);
  const [tier, setTier] = React.useState(() => readPersisted(sessionId).tier);
  const [auto, setAuto] = React.useState(() => readPersisted(sessionId).auto);
  const [pending, setPending] = React.useState(false);
  const [banner, setBanner] = React.useState(null);
  const rootRef = React.useRef(null);

  const { ratio, total, contextWindow } = useOccupancy(props);

  const persist = React.useCallback(
    (nextTier, nextAuto) => {
      setTier(nextTier);
      setAuto(nextAuto);
      writePersisted(sessionId, nextTier, nextAuto);
    },
    [sessionId],
  );

  const flash = React.useCallback((text, kind) => {
    setBanner({ text, kind });
    showToast(ctx, text, kind);
    window.setTimeout(() => setBanner(null), 4000);
  }, [ctx]);

  const onApply = React.useCallback(async () => {
    if (pending) return;
    if (isTierOverCap(tier)) {
      flash(`当前档位 ${tier} 超出本模型上下文窗口（${windowText}），请选择一个不超出上限的档位。`, "error");
      return;
    }
    setPending(true);
    try {
      const payload = JSON.stringify({ sessionId, tier, auto });
      const line = `/context-gear-apply ${payload}`;
      const remote = ctx && ctx.remote && ctx.remote.commands;
      if (!remote || typeof remote.execute !== "function") {
        flash("未检测到命令执行通道（remote.commands）。", "error");
        return;
      }
      const outcome = await remote.execute(sessionId, line, []);
      if (!outcome || outcome.ok === false) {
        flash(`触发失败：${outcome && outcome.error ? outcome.error.message : "命令执行通道返回失败"}`.trim(), "error");
        return;
      }
      const result = outcome.value && outcome.value.result;
      if (result && result.kind === "error") flash(result.text, "error");
      else if (result && result.kind === "success") flash(result.text || "已触发压缩。", "success");
      else flash("已触发压缩。", "success");
    } catch (err) {
      flash(`触发失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setPending(false);
    }
  }, [pending, sessionId, tier, auto, ctx, flash]);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(TIER_PROMPTS[tier]);
      flash("软提示已复制到剪贴板（不会自动写入对话）。", "success");
    } catch {
      flash("复制失败：剪贴板不可用。", "error");
    }
  }, [tier, flash]);

  // 模型上限保护：当前档位超过本模型上下文窗口时，自动降级到不超上限的最高档位。
  React.useEffect(() => {
    if (contextWindow == null) return;
    if (!isTierOverCap(tier)) return;
    let fallback= null;
    for (const t of TIERS) {
      if (!isTierOverCap(t)) fallback = t;
    }
    if (fallback && fallback !== tier) {
      persist(fallback, auto);
      flash(`当前模型窗口约 ${formatK(contextWindow)}，已自动从 ${tier} 降到 ${fallback}（不超过窗口上限）。`, "success");
    }
  }, [contextWindow, tier, auto, persist, flash]);

  // 点外面关闭面板
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 占用读数（与上下文医生同口径）
  const pct = ratio == null ? null : Math.round(ratio * 100);
  let dotColor = "var(--dsw-alias-state-neutral, #8b93a1)";
  if (pct != null && pct >= 90) dotColor = "var(--dsw-alias-state-error-primary, #e5534b)";
  else if (pct != null && pct >= 75) dotColor = "var(--dsw-alias-state-warn-primary, #e0a93b)";
  else if (pct != null) dotColor = "var(--dsw-alias-state-ok-primary, #3fb950)";
  const windowText = contextWindow != null ? `本模型上下文窗口约 ${formatK(contextWindow)}` : "模型上下文窗口未知";
  const occupancyText = pct == null
    ? `占用数据尚未就绪（聊一轮后出现）· ${windowText}`
    : `已用约 ${pct}% 的模型上下文窗口 · ${windowText}`;
  const isTierOverCap = (t) => {
    if (!(contextWindow && contextWindow > 0)) return false; // 窗口未知/无效时不拦截
    const pol = TIER_POLICY[t];
    return pol ? pol.maxTokens > contextWindow : false;
  };

  const gearTitle =
    "上下文压缩档位 · dsh-context-gear\n" +
    "点击打开面板：选择压缩档位、查看「压到多少 / 保留多少」、触发一次 /compact。\n" +
    occupancyText;

  return React.createElement(
    "div",
    { className: "cg_root", ref: rootRef, "data-plugin-css": "@deepseek-ai/dsh-context-gear" },
    React.createElement(
      "button",
      {
        type: "button",
        className: "cg_gear" + (open ? " cg_gear_open" : ""),
        onClick: (e) => { e.preventDefault(); setOpen(!open); },
        title: gearTitle,
        "aria-expanded": open ? "true" : "false",
      },
      React.createElement(
        "span",
        { className: "cg_gear_icon", "aria-hidden": "true" },
        React.createElement(
          "svg",
          { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
          React.createElement("path", { d: "M3 5h18l-7 8v6l-4 2v-8z" }),
        ),
      ),
      React.createElement("span", { className: "cg_gear_label" }, "压缩"),
      React.createElement("span", { className: "cg_gear_dot", style: { background: dotColor }, title: occupancyText }),
    ),
    open
      ? React.createElement(
          "div",
          { className: "cg_panel", role: "dialog", "aria-label": "上下文压缩档位" },
          // 面板头
          React.createElement(
            "div",
            { className: "cg_panel_head" },
            React.createElement("span", { className: "cg_panel_title" }, "上下文压缩"),
            React.createElement("span", { className: "cg_panel_occ", style: { color: dotColor } }, occupancyText),
          ),
          // 档位列表：每行显示 压到 X · 保留 Y
          React.createElement(
            "div",
            { className: "cg_tierlist", role: "radiogroup", "aria-label": "压缩档位" },
            TIERS.map((t) => {
              const pol = TIER_POLICY[t];
              const on = t === tier;
              const overCap = isTierOverCap(t);
              const rowTitle =
                (on ? `当前档位 ${t}。\n` : `切到 ${t}。\n`) +
                `压缩后总上下文压到 ${formatK(pol.maxTokens)} token 以内；\n` +
                `最近 ${formatK(pol.retainTokens)} token 原样保留（不摘要），\n` +
                "更早的历史才被浓缩成结构化摘要。" +
                (overCap ? `\\n⚠️ 超出本模型上下文窗口（${windowText}），禁用。` : "");
              return React.createElement(
                "button",
                {
                  key: t,
                  type: "button",
                  className: "cg_tierrow" + (on ? " cg_tierrow_on" : "") + (overCap ? " cg_tierrow_off" : ""),
                  "aria-pressed": on ? "true" : "false",
                  disabled: pending || overCap,
                  title: rowTitle,
                  onClick: (e) => { e.preventDefault(); if (!overCap) persist(t, auto); },
                },
                React.createElement("span", { className: "cg_tierrow_name" }, t),
                React.createElement("span", { className: "cg_tierrow_detail" },
                  overCap ? "超出本模型上下文上限" : `压到 ${formatK(pol.maxTokens)} · 保留 ${formatK(pol.retainTokens)}`),
                React.createElement("span", { className: "cg_tierrow_check" + (on ? " cg_show" : "") }, "✓"),
              );
            }),
          ),
          // 自动压缩开关
          React.createElement(
            "label",
            {
              className: "cg_toggle",
              title: "开启后，当上下文占用达到 75% 时，DSH 压缩引擎会自动触发一次压缩（全局开关，作用所有会话）。默认开。",
            },
            React.createElement("input", {
              type: "checkbox",
              checked: auto,
              disabled: pending,
              onChange: (e) => persist(tier, e.target.checked),
            }),
            React.createElement("span", null, "自动压缩（占用 75% 时触发）"),
          ),
          // 操作行
          React.createElement(
            "div",
            { className: "cg_actions" },
            React.createElement(
              "button",
              {
                className: "cg_btn cg_btn_primary",
                disabled: pending,
                onClick: onApply,
                title:
                  "【应用并压缩】是什么：\n" +
                  `把档位 ${tier} 的策略写进压缩引擎，并立刻触发一次 /compact——\n` +
                  "把久远的对话浓缩成结构化摘要，系统提示和最近几轮原样保留，不破坏 KV 缓存。\n" +
                  "它只作用于【当前这一个对话】，不影响其它对话；下次新开对话默认回到 300k。\n" +
                  "插件本身不写摘要，全部交给 DSH 内置 dsh-compaction-basic 引擎。",
              },
              pending ? "压缩中…" : "应用并压缩",
            ),
            React.createElement(
              "button",
              {
                className: "cg_btn",
                disabled: pending,
                onClick: onCopy,
                title: "复制当前档位的「软提示」全文到剪贴板，供你手动粘贴到对话里指导压缩力度。注意：插件【不会】自动把它写进对话。",
              },
              "复制软提示",
            ),
          ),
          banner
            ? React.createElement(
                "div",
                { className: banner.kind === "error" ? "cg_banner cg_banner_err" : "cg_banner" },
                banner.text,
              )
            : null,
        )
      : null,
  );
}

// ---- slot registration + style injection ----
function injectStyle() {
  const tagId = "@deepseek-ai/dsh-context-gear/dock.css";
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@deepseek-ai/dsh-context-gear";
    tag.dataset.pluginCss = tagId;
    tag.textContent = STYLE_TEXT;
    document.head.appendChild(tag);
  }
}

const STYLE_TEXT = `
/* 根：挂在 composer 工具行内（conversation.input.left），只占一个按钮位 */
.cg_root{position:relative;display:inline-flex;flex:none;max-width:100%}
/* 压缩按钮（专属：漏斗图标 + 压缩标签 + 占用圆点） */
.cg_gear{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;color:var(--dsw-alias-label-tertiary,#8b93a1);background:transparent;border:1px solid var(--dsw-alias-border-l1,#2c3038);border-radius:7px;cursor:pointer;transition:background .14s ease,color .14s ease,border-color .14s ease}
.cg_gear:hover{color:var(--dsw-alias-label-primary,#e6e8eb);background:var(--dsw-alias-interactive-bg,#24272e)}
.cg_gear_open{color:var(--dsw-alias-accent,#5b8af0);background:color-mix(in srgb,var(--dsw-alias-accent,#3b6fd4) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-accent,#3b6fd4) 45%,transparent)}
.cg_gear_icon{display:inline-flex;align-items:center;color:inherit}
.cg_gear_icon svg{display:block}
.cg_gear_label{font-size:11px;font-weight:700;letter-spacing:.02em;color:inherit;line-height:1}
.cg_gear_dot{width:6px;height:6px;border-radius:50%;flex:none;box-shadow:0 0 0 2px rgba(0,0,0,.15);margin-left:1px}
/* 弹出面板 */
.cg_panel{position:absolute;bottom:calc(100% + 8px);left:0;z-index:50;width:300px;min-width:300px;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#2c3038);background:var(--dsw-specific-menu,#1c1f26);box-shadow:0 8px 28px rgba(0,0,0,.5);animation:cg_in .12s ease}
@keyframes cg_in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.cg_panel_head{display:flex;flex-direction:column;align-items:stretch;gap:2px;min-width:0}
.cg_panel_title{color:var(--dsw-alias-label-primary,#e6e8eb);font-size:13px;font-weight:700;white-space:nowrap}
.cg_panel_occ{font-size:11px;line-height:16px;white-space:normal;word-break:break-word;font-variant-numeric:tabular-nums;opacity:.9}
/* 档位行 */
.cg_tierlist{display:flex;flex-direction:column;gap:3px}
.cg_tierrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 9px;color:var(--dsw-alias-label-secondary,#b9bfc9);background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer;text-align:left;transition:background .13s ease,border-color .13s ease}
.cg_tierrow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg,#24272e)}
.cg_tierrow:disabled{opacity:.45;cursor:default}
.cg_tierrow_off .cg_tierrow_name,.cg_tierrow_off .cg_tierrow_detail{color:var(--dsw-alias-state-error-primary,#e5534b);text-decoration:line-through}
.cg_tierrow_on{background:color-mix(in srgb, var(--dsw-alias-accent,#3b6fd4) 16%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-accent,#3b6fd4) 45%, transparent)}
.cg_tierrow_name{color:var(--dsw-alias-label-primary,#e6e8eb);font-size:12px;font-weight:700;width:36px;flex:none}
.cg_tierrow_detail{flex:1;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.cg_tierrow_check{width:14px;flex:none;color:var(--dsw-alias-accent,#5b8af0);font-size:12px;font-weight:700;visibility:hidden}
.cg_tierrow_check.cg_show{visibility:visible}
/* 自动压缩 */
.cg_toggle{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,#b9bfc9);font-size:11px;cursor:pointer;user-select:none}
.cg_toggle input{cursor:pointer;accent-color:var(--dsw-alias-accent,#3b6fd4);width:13px;height:13px;margin:0}
/* 操作行 */
.cg_actions{display:flex;gap:6px}
.cg_btn{flex:1;height:28px;padding:0 10px;color:var(--dsw-alias-label-secondary,#b9bfc9);background:var(--dsw-alias-interactive-bg,#24272e);border:1px solid var(--dsw-alias-border-l1,#2c3038);border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .14s ease,color .14s ease,border-color .14s ease;white-space:nowrap}
.cg_btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e8eb);border-color:var(--dsw-alias-border-l2,#3a3f4a)}
.cg_btn:disabled{opacity:.4;cursor:default}
.cg_btn_primary{background:var(--dsw-alias-accent,#3b6fd4);border-color:transparent;color:#fff}
.cg_btn_primary:hover:not(:disabled){background:var(--dsw-alias-accent-hover,#4f82e6);color:#fff}
/* 提示条 */
.cg_banner{color:var(--dsw-alias-label-primary,#e6e8eb);font-size:11px;line-height:15px}
.cg_banner_err{color:var(--dsw-alias-state-error-primary,#e5534b)}
`;
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-context-gear",
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    ReactRef = require("react");

    exports.apply = function apply(ctx) {
      injectStyle();
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          {
            name: "conversation.input.left",
            id: "context-gear",
            order: 10,
          },
          (props) =>
            ReactRef.createElement(ContextGearButton, { ...props, ctx }),
        ),
      );
    };
    exports.inject = ["slots", "remote", "remote.commands"];

    return module.exports;
  },
});
