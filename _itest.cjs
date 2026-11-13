// Real-render integration test: occupancy readout + window-cap protection.
// Loads the shipping build (lib/client.js) with a minimal React + fake DSH runtime.
//
// Goal: prove the two behaviors the user worries about are wired correctly:
//   (a) a model whose context window is smaller than a tier cannot select that tier
//       (the row is disabled + marked "超出本模型上下文上限");
//   (b) clicking "应用并压缩" on an over-cap tier is blocked (no command dispatched),
//       while a legal tier dispatches /context-gear-apply via ctx.remote.commands.execute.
const fs = require('fs');
const path = require('path');

// ---- fake DOM / browser globals ----
global.window = {
  localStorage: new Map(),
  setTimeout: setTimeout.bind(global),
  clearTimeout: clearTimeout.bind(global),
  addEventListener: () => {}, removeEventListener: () => {},
  showToast: undefined,
};
global.window.localStorage.getItem = (k) => (global.window.localStorage.has(k) ? global.window.localStorage.get(k) : null);
global.window.localStorage.setItem = (k, v) => global.window.localStorage.set(k, v);
global.window.localStorage.removeItem = (k) => global.window.localStorage.delete(k);
// the build references `localStorage` as a bare global (browser semantics)
global.localStorage = global.window.localStorage;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.document = {
  createElement: () => ({ style: {}, dataset: {}, setAttribute: () => {}, appendChild: () => {} }),
  body: { appendChild: () => {} }, head: { appendChild: () => {} },
  addEventListener: () => {}, removeEventListener: () => {},
  querySelector: () => null,
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.setTimeout = setTimeout;

// ---- minimal React with a persistent hook cursor (so state survives re-renders) ----
const STATE = [];
let hookCursor = 0;
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat(Infinity) }),
  useRef: (v) => ({ current: v }),
  useState: (init) => {
    const i = hookCursor++;
    if (!(i in STATE)) STATE[i] = typeof init === 'function' ? init() : init;
    return [STATE[i], (v) => { STATE[i] = typeof v === 'function' ? v(STATE[i]) : v; }];
  },
  useCallback: (fn) => fn,
  useEffect: () => {}, // effects intentionally not run (we test static tree + guards)
};
global.ReactRef = React;

function resetCursor() { hookCursor = 0; }

// Recursively render: call function components, collect host (string-type) elements.
function render(el) {
  if (!el || typeof el !== 'object') return el;
  if (typeof el.type === 'function') {
    resetCursor();
    return render(el.type(el.props));
  }
  const children = Array.isArray(el.children) ? el.children.map(render) : el.children;
  return { type: el.type, props: el.props, children };
}

function walk(node) {
  const out = [];
  (function rec(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.type === 'string') out.push(n);
    const ch = n.children || [];
    for (const c of ch) rec(c);
  })(node);
  return out;
}

// recursively collect text from an element (handles nested host spans).
// In our fake React, children live on `el.children` (createElement puts the
// trailing args there), so check that before `el.props.children`.
function textOf(el) {
  if (el == null) return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(textOf).join('');
  if (typeof el === 'object') {
    if (Array.isArray(el.children)) return textOf(el.children);
    if (el.props) return textOf(el.props.children);
  }
  return '';
}

function useProjection(name) {
  if (name === 'contextPressure') {
    const win = process.env.WIN ? Number(process.env.WIN) : 0;
    if (!win) return undefined; // window unknown (never mounted)
    return { projectedTokens: Math.round(win * 0.7), pressureTokens: Math.round(win * 0.7), contextWindow: win };
  }
  return undefined;
}

// ---- load the shipping client build ----
const src = fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8');
let capturedFactory = null;
global.window.__ModuleLoader__ = { load: (spec) => { capturedFactory = spec.factory; } };
const req = (id) => { if (id === 'react') return React; throw new Error('bare import ' + id); };
new Function('window', 'document', 'navigator', src)(global.window, global.document, global.navigator);
const realExports = capturedFactory(req);
const apply = realExports.apply;

// ---- fake ctx: slots.inject invokes the callback (mirrors real DSH), register captures the factory ----
const execCalls = [];
let Comp = null;
const ctx = {
  slots: {
    inject: (name, cb) => cb(),
    register: (meta, factory) => { Comp = factory; },
  },
  remote: { commands: { execute: async (sid, line) => { execCalls.push({ sid, line }); return { ok: true, value: { result: { kind: 'success', text: 'ok' } } }; } } },
  toast: (m) => {},
};

apply(ctx);
if (!Comp) { console.log('FAIL: component factory not registered'); process.exit(1); }

function run(label) {
  // fresh per-scenario state
  STATE.length = 0;
  resetCursor();
  if (process.env.TIER) global.window.localStorage.set('dsh-context-gear:s1', JSON.stringify({ tier: process.env.TIER, auto: true }));
  else global.window.localStorage.delete('dsh-context-gear:s1');

  const props = { sessionId: 's1', useProjection, useSession: () => ({}), ctx };
  // open the panel: render, click gear, render again (state persists across renders)
  render(React.createElement(Comp, props));
  const hasTok = (el, tok) => (el.props.className || '').split(/\s+/).includes(tok);
  const gear = walk(render(React.createElement(Comp, props))).find((h) => hasTok(h, 'cg_gear'));
  if (gear) gear.props.onClick({ preventDefault() {} });
  const hosts = walk(render(React.createElement(Comp, props)));
  const tiers = hosts.filter((h) => hasTok(h, 'cg_tierrow'));
  const applyBtns = hosts.filter((h) => hasTok(h, 'cg_btn_primary'));

  console.log('\n=== ' + label + ' ===');
  console.log('tier rows:', tiers.length);
  tiers.forEach((t, i) => {
    const kids = t.children || [];
    const name = textOf(kids[0]);
    const detail = textOf(kids[1]);
    console.log(`  [${i}] ${name.padEnd(5)}  ${hasTok(t, 'cg_tierrow_off') ? 'OFF/disabled' : 'on        '}  disabled=${t.props.disabled}  "${detail}"`);
  });

  // v0.2.1 regression: over-cap tier tooltip must use a real newline, not a
  // literal backslash-n. Check the first disabled (over-cap) row's title.
  const overRow = tiers.find((t) => t.props.disabled && (t.children || []).some((c) => textOf(c).includes('超出本模型上下文上限')));
  let tooltipOk = true;
  if (overRow && overRow.props.title) {
    const hasLiteralBackslashN = overRow.props.title.includes('\\n');
    const hasRealNewline = overRow.props.title.includes('\n');
    tooltipOk = !hasLiteralBackslashN && hasRealNewline;
    console.log(`  over-cap tooltip: realNewline=${hasRealNewline} literalBackslashN=${hasLiteralBackslashN} | TOOLTIP=${tooltipOk}`);
  }

  const win = process.env.WIN ? Number(process.env.WIN) : 0;
  const okRows = tiers.length === 5;
  let capOk = true;
  if (win > 0 && win < 300000) {
    // 200k enabled, 300k+ disabled
    capOk = !tiers[0].props.disabled && tiers[1].props.disabled && tiers[2].props.disabled && tiers[3].props.disabled && tiers[4].props.disabled;
  } else if (win >= 1000000) {
    capOk = tiers.every((t) => !t.props.disabled);
  } // win unknown: all enabled (no interception)

  // apply-button guard test
  execCalls.length = 0;
  const applyBtn = applyBtns[0];
  (async () => {
    applyBtn.props.onClick({ preventDefault() {} });
    await new Promise((r) => setTimeout(r, 30));
    const expect = (process.env.TIER || '300k');
    let expectCalls = 1;
    if (win > 0 && win < 300000) {
      expectCalls = expect === '200k' ? 1 : 0; // 300k default is over-cap -> blocked
    }
    const guardOk = execCalls.length === expectCalls;
    console.log(`  apply(${expect}) -> execute calls: ${execCalls.length} (expect ${expectCalls}) | GUARD=${guardOk}`);
    if (expectCalls === 1 && execCalls.length === 1) console.log('    dispatched line:', execCalls[0].line);
    const pass = okRows && capOk && guardOk;
    console.log('  SCENARIO PASS =', pass);
    if (!pass) process.exitCode = 1;
  })();
}

// Scenario A: 256k window, default tier 300k (over-cap -> blocked, only 200k enabled)
process.env.WIN = '256000';
delete process.env.TIER;
run('256k window / default 300k');

setTimeout(() => {
  // Scenario B: 2M window, all enabled; preset 200k
  process.env.WIN = '2000000'; process.env.TIER = '200k';
  run('2M window / preset 200k');

  setTimeout(() => {
    // Scenario C: unknown window (no contextPressure mounted) -> nothing disabled, no interception
    delete process.env.WIN; delete process.env.TIER;
    run('unknown window / no mount');
    setTimeout(() => {}, 50);
  }, 50);
}, 50);
