// Smoke test the browser half in isolation: stub the pieces client.tsx relies on
// (window.__ModuleLoader__, a minimal React, a ctx with slots/commands) and assert
// the factory registers the conversation.input.left slot and the dock creator returns
// the ContextGearDock element. This proves the module wires up without runtime errors.
// It does NOT validate against the real DSH runtime (no network/registry here).
global.window = global;
global.navigator = { clipboard: { writeText: async () => {} } };
global.document = {
  querySelector: () => null,
  createElement: (t) => ({ tag: t, dataset: {}, set textContent(v) { this._t = v; } }),
  head: { appendChild() {} },
};
global.localStorage = {
  _m: {},
  getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); },
};
let moduleLoaderPayload = null;
global.window.__ModuleLoader__ = {
  load(payload) { moduleLoaderPayload = payload; },
};

// Minimal React: createElement just records args so we can inspect the tree.
function createElement(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat() };
}
const React = {
  createElement,
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useCallback: (fn) => fn,
  useMemo: (fn) => typeof fn === "function" ? fn() : fn,
};
const moduleTable = { react: React, "react/jsx-runtime": { jsx: createElement, jsxs: createElement, Fragment: "Fragment" } };
function requireShim(name) { if (moduleTable[name]) return moduleTable[name]; throw new Error("no stub for " + name); }

const fs = require("fs");
// Smoke-test the SHIPPED browser bundle (lib/client.js), not the TS source.
const stripped = fs.readFileSync("D:/AI/DeepSeekChat/dsh-context-gear/lib/client.js", "utf8");
// Evaluate the module body; it calls window.__ModuleLoader__.load({id, factory}).
const factoryWrap = new Function("require", "window", "document", "navigator", "localStorage", stripped);
factoryWrap(requireShim, global.window, global.document, global.navigator, global.localStorage);

if (!moduleLoaderPayload) { console.log("FAIL: module loader never called"); process.exit(1); }
console.log("module id:", moduleLoaderPayload.id);

const plugin = moduleLoaderPayload.factory(requireShim);
console.log("factory inject:", JSON.stringify(plugin.inject));

// Stub a Cordis ctx: slots.inject captures the register callback; remote.commands.execute
// returns a fake result. The slot component receives `sessionId` (and ctx) via props.
let registeredSlot = null;
let dispatched = null;
const ctx = {
  slots: {
    inject(slotName, registerFn) {
      registeredSlot = { slotName, registerFn };
      return () => {};
    },
    register(meta, factory) { return factory({ sessionId: "session-xyz" }); },
  },
  remote: {
    commands: {
      execute: async (sessionId, line, attachments) => {
        dispatched = { sessionId, line, attachments };
        return { ok: true, value: { commandId: "smoke", result: { kind: "success", text: "smoke ok" } } };
      },
    },
  },
};

plugin.apply(ctx);
if (!registeredSlot || registeredSlot.slotName !== "conversation.input.left") {
  console.log("FAIL: did not register conversation.input.left"); process.exit(1);
}
// apply() called slots.inject(slot, () => slots.register(meta, factory)); the
// returned arrow ignores its own arg and returns the dock element via our stub.
const dockElement = registeredSlot.registerFn({ name: "conversation.input.left", id: "context-gear", order: 10 });
if (!dockElement || typeof dockElement.tag !== "function") {
  console.log("FAIL: dock creator did not return the ContextGearDock element"); process.exit(1);
}
console.log("dock element tag:", dockElement.tag.name);
if (dockElement.props && dockElement.props.sessionId !== "session-xyz") {
  console.log("FAIL: sessionId not threaded into the dock"); process.exit(1);
}
console.log("SMOKE PASS");
