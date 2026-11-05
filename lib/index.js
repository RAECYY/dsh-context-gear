/**
 * @deepseek-ai/dsh-context-gear — Host half.
 *
 * Pure scheduler: it registers one command (`context-gear-apply`) that the
 * browser dock dispatches when the user clicks "应用档位并压缩". The handler
 * reads the chosen tier, best-effort merges that tier's policy keys into the
 * mounted compaction engine, and triggers one on-demand condensation through
 * the backend-independent `ctx.compaction.compactNow` seam (the same seam the
 * built-in `/compact` command uses). It never summarizes, and it never reads
 * or rewrites conversation messages.
 *
 * Wire contract (verified against @deepseek-ai/dsh 0.2.1-rc.5):
 *   - command names must match /^[a-z][a-z0-9_-]*$/ (no colon).
 *   - the handler receives `{ commandId, agent, rawInput, attachments, signal }`;
 *     structured arguments travel in `rawInput` (the trailing slash text).
 *   - `ctx.compaction.compactNow(agent, signal, commandId)` returns
 *     `{ shadowedSeqs, shadowedTokenCount, summarySeq }` or `null`.
 *
 * ⚠️ 重要底层限制（与 README 一致）
 * 1. 本插件仅调度 dsh-compaction-basic，无法修改引擎内部摘要 prompt；软提示只
 *    在浏览器侧展示/供用户手动复制，不会自动注入对话。
 * 2. auto 自动压缩开关为全局，切换会作用所有会话，无法做到会话独立 auto 开关。
 * 3. 若 dsh-compaction-basic 不支持运行时动态策略覆盖，档位变更将在下一次自动
 *    压缩生效（本处理会在触发前尽力合并策略，但引擎是否采用取决于其实现）。
 * 4. 插件不会自动修改会话消息，避免破坏 KV 缓存。
 *
 * 浏览器控制条读取与内置「上下文医生」(dsh-context-doctor)
 * 同一套 `contextPressure` 投影，显示当前窗口占用百分比——医生负责诊断，
 * gear 负责执行，二者数据同口径、天然互补、不冲突。
 */

// ⚠️ host 半不 import 任何裸 @deepseek-ai/* 包：它们打包在 DSH 运行时内部，
// 不在 profile 的 node_modules 里，从 profile 目录加载时解析不到会导致整个
// 插件加载失败（0.2.1-rc.5 实测）。CommandDefinitionId 在官方源码里就是恒等
// 函数；ManualCompactionError 用鸭子类型（name + code）识别，语义等价。

//#region inline brand + duck-typed error
/** Mirror of `CommandDefinitionId` from `@deepseek-ai/dsh-commands/brand` (identity). */
function CommandDefinitionId(id) {
  return id;
}

/** Duck-typed check for `ManualCompactionError` (avoids a bare runtime import). */
function isManualCompactionError(error) {
  return (
    error instanceof Error &&
    (error).name === "ManualCompactionError" &&
    typeof (error).code === "string"
  );
}
//#endregion

//#region tier policy + soft prompts
/**
 * Tier -> compaction-basic policy mapping.
 *
 * Every tier keeps the engine's automatic trigger at 75% context occupancy
 * (`thresholdRatio`). `maxTokens` is the hard target ceiling for the condensed
 * whole context; `retainTokens` is the tail budget preserved verbatim (an
 * approximation of "keep the most recent N rounds", not an exact round count).
 */
const TIER_POLICY= {
  "200k": { maxTokens: 200000,  retainTokens: 60000,  thresholdRatio: 0.75 },
  "300k": { maxTokens: 300000,  retainTokens: 90000,  thresholdRatio: 0.75 },
  "500k": { maxTokens: 500000,  retainTokens: 150000, thresholdRatio: 0.75 },
  "800k": { maxTokens: 800000,  retainTokens: 240000, thresholdRatio: 0.75 },
  "1M":   { maxTokens: 1000000, retainTokens: 300000, thresholdRatio: 0.75 },
};
// retainTokens：尾部原始上下文保留 token 预算（近似最近 N 轮，不保证精确轮数）

const TIER_PROMPTS= {
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
3. 仅压缩非常久远的历史，尽可能保留全部项目脉络、方案、讨论记录。
4. 适合长期大项目、需要完整历史追溯，开销最高。`,
};
//#endregion

//#region types

/** Duck-typed shape of a ManualCompactionError (see isManualCompactionError). */

//#endregion

//#region per-session debounce lock
const busySessions = new Set();
//#endregion

//#region failure-text forwarding (mirrors dsh-command-compact's expectedFailure)
function expectedFailure(error) {
  switch (error.code) {
    case "busy":
      return { kind: "error", text: "压缩正在进行中，或当前 agent 不空闲，请稍后再试。" };
    case "cancelled":
      return { kind: "error", text: "压缩已取消。" };
    case "changed":
      return { kind: "error", text: "待压缩的历史在选择后发生了变化，本次操作已记录到会话日志。" };
    case "summary":
      return { kind: "error", text: "压缩未能生成有用的摘要，本次操作已记录到会话日志。" };
    case "commit":
      return { kind: "error", text: "压缩未干净结束，部分会话历史可能已变化，重试前请检查当前会话状态。" };
    case "persistence":
      return { kind: "error", text: "压缩已完成，但会话未能保存。" };
    default:
      return { kind: "error", text: `压缩失败：${error.message ?? error.code}` };
  }
}
//#endregion

//#region best-effort live policy merge
/**
 * Best-effort: push the chosen tier's policy into the mounted compaction
 * engine. The engine (dsh-compaction-basic) reads its policy from `this.config`
 * at trigger time, so merging there influences the next `compactNow`. If the
 * engine is frozen or exposes no mutable config, this silently no-ops — the
 * limitation is documented in the README (tier may apply on the next automatic
 * compaction instead). We never throw here; triggering compaction is the key
 * action and must still run.
 */
function applyTierToEngine(engine, tier, auto) {
  const policy = TIER_POLICY[tier];
  if (!policy || !engine || typeof engine !== "object") return;
  try {
    const cfg = (engine).config;
    if (cfg && typeof cfg === "object") {
      // Copy-on-write: replace the reference so a frozen original is untouched.
      const next = { ...cfg, thresholdRatio: policy.thresholdRatio, retainTokens: policy.retainTokens, maxTokens: policy.maxTokens, auto };
      (engine).config = next;
    }
  } catch {
    // Engine config is not runtime-mutable in this build; safe to ignore.
  }
}
//#endregion

//#region command handler
async function executeApply(ctx, invocation) {
  // Structured args travel in the slash command's trailing text
  // (`rawInput`), not in an `input` field (which is only a UI hint in dsh).
  let args;
  try {
    args = JSON.parse((invocation.rawInput || "").trim() || "{}");
  } catch {
    return { kind: "error", text: "参数解析失败。" };
  }

  const { tier, auto } = args;
  // sessionId comes from the agent the command was addressed to; the client
  // echoes it convenience but the authoritative value is invocation.agent.
  const sessionId = typeof args.sessionId === "string" && args.sessionId.length > 0
    ? args.sessionId
    : (invocation.agent?.session?.id ?? invocation.agent?.sessionId ?? "");
  if (typeof tier !== "string") {
    return { kind: "error", text: "缺少 tier 参数。" };
  }
  if (sessionId.length === 0) {
    return { kind: "error", text: "无法确定目标会话。" };
  }
  if (!TIER_POLICY[tier]) {
    return { kind: "error", text: `未知档位：${tier}` };
  }

  // Per-session debounce: refuse a second trigger while one is in flight.
  if (busySessions.has(sessionId)) {
    return { kind: "error", text: "压缩正在进行中，请稍后再点" };
  }

  const engine = ctx.compaction;
  if (!engine || typeof engine.compactNow !== "function") {
    return {
      kind: "error",
      text: "未检测到压缩后端。请先安装并挂载 @deepseek-ai/dsh-compaction-basic，再使用本插件。",
    };
  }

  busySessions.add(sessionId);
  try {
    applyTierToEngine(engine, tier, auto === true);
    const result = await engine.compactNow(invocation.agent, invocation.signal, invocation.commandId);
    if (result === null) {
      return { kind: "success", text: `已应用档位 ${tier}，但当前暂无可压缩的历史。` };
    }
    return {
      kind: "success",
      text: `已应用档位 ${tier} 并触发压缩，压缩了 ${result.shadowedSeqs.length} 条历史（约 ${result.shadowedTokenCount} token）。`,
      sourceEventSeq: result.summarySeq,
    };
  } catch (error) {
    if (invocation.signal?.aborted) return { kind: "error", text: "压缩已取消。" };
    if (isManualCompactionError(error)) return expectedFailure(error);
    return { kind: "error", text: `压缩失败：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    busySessions.delete(sessionId);
  }
}
//#endregion

//#region plugin entry
export const name = "context-gear";
export const inject = ["commands", "compaction", "sessions"];

export function apply(ctx) {
  const active = new Set();
  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled(active);
    };
    yield ctx.commands.register({
      definitionId: CommandDefinitionId("@deepseek-ai/dsh-context-gear"),
      name: "context-gear-apply",
      description: "应用上下文压缩档位（200k/300k/500k/800k/1M）并触发一次上下文压缩。仅调度 dsh-compaction-basic，不自行实现压缩。",
      handler(invocation) {
        const op = executeApply(ctx, invocation);
        active.add(op);
        const retire = () => active.delete(op);
        op.then(retire, retire);
        return op;
      },
    });
  }, "context-gear command lifecycle");
}

// Re-export the constants so the client bundle can import the same prompts/policy
// when built from this source tree (bundlers resolve the package self-import).
export { TIER_POLICY, TIER_PROMPTS };
//#endregion
