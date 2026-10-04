import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachSessionTimeout, BACKGROUND_TIMEOUT_MS } from "../src/session-timeout.js";

function harness({ saved = null, active = true } = {}) {
  const page = new EventTarget(), ownerWindow = new EventTarget();
  page.hidden = false;
  let clock = 1000, loggedIn = active, timer = null;
  const values = new Map(saved === null ? [] : [["simuBackgroundSince", String(saved)]]);
  const expired = [];
  const controller = attachSessionTimeout({ page, ownerWindow,
    storage: { getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    active: () => loggedIn, onExpire: (deadline) => { expired.push(deadline); loggedIn = false; },
    now: () => clock, schedule: (fn) => { timer = fn; return 1; }, unschedule: () => { timer = null; },
  });
  return { page, ownerWindow, controller, expired, values,
    advance(ms) { clock += ms; }, login() { loggedIn = true; },
    hide() { page.hidden = true; page.dispatchEvent(new Event("visibilitychange")); },
    show() { page.hidden = false; page.dispatchEvent(new Event("visibilitychange")); },
    fireTimer() { timer?.(); } };
}

test("five minutes in background expires once, with the original deadline", () => {
  const h = harness(); h.hide(); h.advance(BACKGROUND_TIMEOUT_MS); h.fireTimer();
  assert.deepEqual(h.expired, [301000]);
  h.show(); h.fireTimer(); assert.equal(h.expired.length, 1);
});
test("return before the limit keeps the session and resets the next background period", () => {
  const h = harness(); h.hide(); h.advance(299999); h.show();
  assert.deepEqual(h.expired, []); assert.equal(h.controller.deadline(), null);
  h.hide(); h.advance(1); h.show(); assert.deepEqual(h.expired, []);
});
test("resuming detects expiration even when Android suspended every timer", () => {
  const h = harness(); h.hide(); h.advance(12 * BACKGROUND_TIMEOUT_MS); h.show();
  assert.deepEqual(h.expired, [301000]);
});
test("a foreground session does not expire while the simulator remains open", () => {
  const h = harness(); h.advance(12 * BACKGROUND_TIMEOUT_MS); h.controller.check();
  assert.deepEqual(h.expired, []);
});
test("a stored background time survives reopening and waits for authentication", () => {
  const h = harness({ saved: 1000, active: false });
  h.advance(2 * BACKGROUND_TIMEOUT_MS); h.controller.check();
  assert.equal(h.controller.deadline(), 301000);
  h.login(); assert.equal(h.controller.check(), false);
  assert.deepEqual(h.expired, [301000]);
});
test("repeated hide events cannot postpone expiration", () => {
  const h = harness(); h.hide(); h.advance(200000); h.hide();
  h.advance(100000); h.show(); assert.deepEqual(h.expired, [301000]);
});
test("the first interaction after a delayed resume is blocked before executing a command", () => {
  const h = harness(); h.hide(); h.advance(BACKGROUND_TIMEOUT_MS);
  h.page.hidden = false;
  const event = new Event("pointerdown", { cancelable: true });
  h.page.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(h.expired.length, 1);
});
test("manual logout clears the deadline for a new login", () => {
  const h = harness(); h.hide(); h.controller.reset();
  h.advance(BACKGROUND_TIMEOUT_MS); h.page.hidden = false; h.controller.check();
  assert.deepEqual(h.expired, []); assert.equal(h.values.size, 0);
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const exitCode = html.slice(html.indexOf("      async function endOperatorSession("),
  html.indexOf("      const sessionTimeout = attachSessionTimeout("));
function exitAdapter({ admin = false, session = null, writer = () => Promise.resolve() } = {}) {
  const nodes = new Map(), values = new Map(), calls = { pauses: 0, resets: 0, signOuts: 0 };
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { open: true, value: "typed", hidden: false,
    close() { this.open = false; }, reset() { this.value = ""; } }); return nodes.get(id); };
  const api = new Function("initial", "admin", "$", "values", "writer", "calls", "Date", `
    let operatorSession=initial, sessionTimer=0, sessionToken="token", sessionClosing=false,
      sessionExitNotice="", pending="dj", busPending="tf", alarmTotal=3, eng=admin;
    const auth={currentUser: {uid:"test-user",isAnonymous:!admin}};
    const operatorDiagramStates=new Map();
    const sessionStorage={getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key)};
    const document={querySelectorAll:()=>[$("#cmd"),$("#loginBox"),$("#operatorBox")]};
    const setMode=(on)=>{eng=on;}, resetControlRuleRuntime=()=>{}, clearInterval=()=>{};
    const timeEngine={pause:()=>calls.pauses++};
    const sessionTimeout={reset:()=>calls.resets++};
    const persistOperatorSession=()=>{
      const saved={...operatorSession,active:false};
      values.set("simuActiveSession",JSON.stringify(saved));
      return writer(saved);
    };
    const signOut=async()=>{calls.signOuts++;auth.currentUser=null;};
    ${exitCode}
    return {logout:logoutSession,end:endOperatorSession,
      snapshot:()=>({operatorSession,sessionToken,eng,pending,busPending,sessionClosing})};
  `)(session, admin, node, values, writer, calls, { now: () => 900000 });
  return { ...api, node, values, calls };
}

test("real operator logout blocks immediately while the final Firebase write stays pending", async () => {
  const h = exitAdapter({ session: { id: "old", startedAt: 1000 }, writer: () => new Promise(() => {}) });
  await h.logout("background", 301000);
  assert.equal(h.snapshot().operatorSession, null); assert.equal(h.snapshot().pending, null);
  assert.equal(h.snapshot().sessionToken, null); assert.equal(h.node("#cmd").open, false);
  assert.equal(h.node("#password").value, "");
  assert.equal(JSON.parse(h.values.get("simuActiveSession")).endedAt, 301000);
});
test("real administrator logout closes dialogs, leaves engineering and clears authentication", async () => {
  const h = exitAdapter({ admin: true }); await h.logout();
  assert.equal(h.snapshot().eng, false); assert.equal(h.calls.signOuts, 1);
  assert.equal(h.node("#loginBox").open, false); assert.equal(h.node("#logout").disabled, false);
});
test("a confirmed history write clears only its own saved session record", async () => {
  let confirm;
  const h = exitAdapter({ session: { id: "old", startedAt: 1000 },
    writer: () => new Promise((resolve) => { confirm = resolve; }) });
  await h.end(); h.values.set("simuActiveSession", JSON.stringify({ id: "new" }));
  confirm(); await Promise.resolve();
  assert.equal(JSON.parse(h.values.get("simuActiveSession")).id, "new");
});
test("a failed final history write preserves the local record and still closes the session", async () => {
  const h = exitAdapter({ session: { id: "old", startedAt: 1000 }, writer: () => Promise.reject(Error("offline")) });
  await h.logout(); await Promise.resolve();
  assert.equal(h.snapshot().operatorSession, null);
  assert.equal(JSON.parse(h.values.get("simuActiveSession")).id, "old");
});
