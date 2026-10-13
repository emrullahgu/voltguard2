'use strict';
// Zero-dependency Chrome DevTools Protocol helper (Node >= 22: global WebSocket + fetch).
// Each launch() gets its own Chrome process, its own temp user-data-dir and an OS-assigned
// debugging port, so any number of harness runs can execute concurrently.

const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { spawn, spawnSync } = require('child_process');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  for (const p of CHROME_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
}

/** file:// URL with correctly encoded path (handles non-ASCII such as 'ü') plus query params.
 *  params: string ('verify&lvl=3') or object ({verify:true, lvl:3}); true -> bare flag. */
function fileUrl(file, params) {
  let href = url.pathToFileURL(path.resolve(file)).href;
  let qs = '';
  if (typeof params === 'string') qs = params.replace(/^\?/, '');
  else if (params && typeof params === 'object') {
    qs = Object.entries(params).filter(([, v]) => v !== false && v != null)
      .map(([k, v]) => v === true ? encodeURIComponent(k) : encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
      .join('&');
  }
  return qs ? href + '?' + qs : href;
}

// ---------------------------------------------------------------- process bookkeeping
const live = new Set();

function rmDirSync(dir) {
  const target = path.resolve(dir);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('voltcdp-')) return;
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (_) {}
}
function killTreeSync(inst) {
  if (inst.exited || !inst.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(inst.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-inst.pid, 'SIGKILL');
  } catch (_) { try { inst.proc.kill('SIGKILL'); } catch (__) {} }
}
process.on('exit', () => {
  for (const inst of live) { killTreeSync(inst); rmDirSync(inst.dir); }
  live.clear();
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => process.exit(130)); } catch (_) {}
}

// ---------------------------------------------------------------- websocket JSON-RPC
class Conn {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = new Map(); this.closed = false; }
  open(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const t = setTimeout(() => { reject(new Error('WebSocket connect timeout ' + this.wsUrl)); try { ws.close(); } catch (_) {} }, timeoutMs);
      ws.onopen = () => { clearTimeout(t); resolve(this); };
      ws.onerror = e => { clearTimeout(t); reject(new Error('WebSocket error: ' + (e && e.message || 'unknown'))); };
      ws.onclose = () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error('CDP connection closed (' + p.method + ')'));
        this.pending.clear();
      };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (_) { return; }
        if (msg.id != null) {
          const p = this.pending.get(msg.id); if (!p) return;
          this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(p.method + ': ' + msg.error.message + (msg.error.data ? ' (' + msg.error.data + ')' : '')));
          else p.resolve(msg.result);
        } else if (msg.method) {
          const ls = this.listeners.get(msg.method);
          if (ls) for (const fn of [...ls]) { try { fn(msg.params || {}); } catch (_) {} }
        }
      };
    });
  }
  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed (' + method + ')'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout after ' + timeoutMs + 'ms: ' + method)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, new Set()); this.listeners.get(method).add(fn); return () => this.listeners.get(method).delete(fn); }
  once(method, timeoutMs = 30000, pred = null) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error('Timeout waiting for ' + method)); }, timeoutMs);
      const off = this.on(method, p => { if (pred && !pred(p)) return; clearTimeout(t); off(); resolve(p); });
    });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function remoteObjToString(o) {
  if (!o) return '';
  if (o.type === 'string') return o.value;
  if ('value' in o) { try { return typeof o.value === 'object' ? JSON.stringify(o.value) : String(o.value); } catch (_) { return String(o.value); } }
  if (o.unserializableValue) return o.unserializableValue;
  return o.description || ('[' + o.type + ']');
}

// ---------------------------------------------------------------- Page
class Page {
  constructor(inst, browser, conn, opts) {
    this.inst = inst; this.browser = browser; this.conn = conn; this.opts = opts;
    this.logs = [];        // {kind:'console'|'exception'|'log', level, text, url, line, t}
    this.closed = false;
  }

  async _init() {
    const c = this.conn;
    c.on('Runtime.consoleAPICalled', p => {
      const level = p.type === 'warning' ? 'warning' : (p.type === 'assert' ? 'error' : p.type);
      const fr = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
      this.logs.push({ kind: 'console', level, text: (p.args || []).map(remoteObjToString).join(' '), url: fr && fr.url, line: fr && fr.lineNumber + 1, t: Date.now() });
    });
    c.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails || {};
      const text = (d.exception && (d.exception.description || remoteObjToString(d.exception))) || d.text || 'exception';
      this.logs.push({ kind: 'exception', level: 'error', text, url: d.url, line: d.lineNumber != null ? d.lineNumber + 1 : undefined, t: Date.now() });
    });
    c.on('Log.entryAdded', p => {
      const e = p.entry || {};
      this.logs.push({ kind: 'log', level: e.level, text: '[' + e.source + '] ' + e.text, url: e.url, line: e.lineNumber, t: Date.now() });
    });
    c.on('Page.javascriptDialogOpening', () => { c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await this.setViewport(this.opts);
  }

  /** Emulate a device. {width,height,mobile,touch,dpr} */
  async setViewport(o = {}) {
    const v = Object.assign({}, this.opts, o);
    this.opts = v;
    const landscape = v.width > v.height;
    await this.conn.send('Emulation.setDeviceMetricsOverride', {
      width: v.width, height: v.height, deviceScaleFactor: v.dpr || 1, mobile: !!v.mobile,
      screenWidth: v.width, screenHeight: v.height,
      screenOrientation: v.mobile ? { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 } : undefined,
    });
    await this.conn.send('Emulation.setTouchEmulationEnabled', { enabled: !!v.touch, maxTouchPoints: v.touch ? 5 : 1 });
    // We dispatch real touch events ourselves, so mouse->touch translation stays off.
    await this.conn.send('Emulation.setEmitTouchEventsForMouse', { enabled: false }).catch(() => {});
    this.touch = !!v.touch;
  }

  /** Navigate. target = absolute URL or local file path (+ params). Resolves on load event. */
  async goto(target, params, timeoutMs = 30000) {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)
      ? (params ? target + (target.includes('?') ? '&' : '?') + (typeof params === 'string' ? params.replace(/^\?/, '') : new URLSearchParams(params).toString()) : target)
      : fileUrl(target, params);
    this.logs.length = 0;
    const loaded = this.conn.once('Page.loadEventFired', timeoutMs);
    loaded.catch(() => {}); // avoid an unhandled rejection if navigate itself throws
    const r = await this.conn.send('Page.navigate', { url: href }, timeoutMs);
    if (r.errorText) throw new Error('Navigation failed: ' + r.errorText + ' ' + href);
    await loaded;
    this.url = href;
    return href;
  }

  /** Evaluate an expression in the page; returns the JSON value. Promises are awaited. */
  async evaluate(expr, timeoutMs = 30000) {
    const src = typeof expr === 'function' ? '(' + expr.toString() + ')()' : String(expr);
    const r = await this.conn.send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true, userGesture: true, timeout: timeoutMs }, timeoutMs + 2000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('evaluate failed: ' + ((d.exception && d.exception.description) || d.text) + '\n  expr: ' + src.slice(0, 200));
    }
    return r.result ? r.result.value : undefined;
  }

  /** Poll until expr is truthy (exceptions count as falsy). Returns the truthy value. */
  async waitFor(expr, timeoutMs = 10000, intervalMs = 100) {
    const wrapped = '(()=>{try{return (' + expr + ')}catch(e){return undefined}})()';
    const end = Date.now() + timeoutMs; let last;
    for (;;) {
      last = await this.evaluate(wrapped);
      if (last) return last;
      if (Date.now() > end) throw new Error('waitFor timeout (' + timeoutMs + 'ms): ' + expr + ' (last=' + JSON.stringify(last) + ')');
      await sleep(intervalMs);
    }
  }

  /** Resolve after n animation frames. */
  frames(n = 2) { return this.evaluate('new Promise(r=>{let k=' + (n | 0) + ';const f=()=>(--k<=0)?r(true):requestAnimationFrame(f);requestAnimationFrame(f)})', 10000); }

  async _touch(type, pts) {
    await this.conn.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }
  async _mouse(type, x, y, buttons) {
    await this.conn.send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons: buttons || 0, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse',
    });
  }

  /** Tap: real touch events when touch emulation is on, otherwise a left mouse click. */
  // Touch: touchStart/touchEnd carry explicit timestamps (t0, t0+holdMs) and are pipelined WITHOUT waiting for
  // the touchStart ACK (controller request #6: on a busy page the ACK took up to 1 s, so the page saw a long press).
  async tap(x, y, holdMs = 60) {
    if (this.touch) {
      const t0 = Date.now();
      const pt = [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      const a = this.conn.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0 / 1000, touchPoints: pt });
      const wait = t0 + holdMs - Date.now(); if (wait > 0) await sleep(wait);
      const b = this.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: (t0 + holdMs) / 1000, touchPoints: [] });
      await Promise.all([a, b]);
    } else {
      await this._mouse('mouseMoved', x, y, 0);
      await this._mouse('mousePressed', x, y, 1);
      await sleep(holdMs);
      await this._mouse('mouseReleased', x, y, 0);
    }
  }

  /** One-finger swipe (touch) or left-button drag (mouse), linearly interpolated. */
  async drag(x1, y1, x2, y2, steps = 12, durationMs = 400) {
    steps = Math.max(1, steps | 0);
    const dt = durationMs / steps;
    if (this.touch) {
      await this._touch('touchStart', [{ x: x1, y: y1 }]);
      for (let i = 1; i <= steps; i++) {
        await sleep(dt);
        await this._touch('touchMove', [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }]);
      }
      await sleep(30);
      await this._touch('touchEnd', []);
    } else {
      await this._mouse('mouseMoved', x1, y1, 0);
      await this._mouse('mousePressed', x1, y1, 1);
      for (let i = 1; i <= steps; i++) {
        await sleep(dt);
        await this._mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, 1);
      }
      await sleep(30);
      await this._mouse('mouseReleased', x2, y2, 0);
    }
  }

  // ------------------------------------------------------------ audit improvements (v2 harness, spec §13 F20)
  /** CPU throttling (1 = none, 4 = 4x slower). */
  async setCPUThrottle(rate = 1) { await this.conn.send('Emulation.setCPUThrottlingRate', { rate: Math.max(1, rate) }); this.cpuRate = rate; }

  /** Script evaluated in every new document before any page script (Page.addScriptToEvaluateOnNewDocument).
   *  src: string or function (called with no args). Returns an identifier for removeInitScript. */
  async addInitScript(src) {
    const source = typeof src === 'function' ? '(' + src.toString() + ')();' : String(src);
    const r = await this.conn.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return r.identifier;
  }
  async removeInitScript(id) { await this.conn.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); }

  /** Key press with proper key/code/keyCode (ArrowUp…, letters, digits, ' '). */
  async key(key, opts = {}) {
    const K = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, ' ': 32, Backspace: 8, Tab: 9 };
    const single = key.length === 1;
    const keyCode = K[key] || (single ? key.toUpperCase().charCodeAt(0) : 0);
    const code = single ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : key === ' ' ? 'Space' : key) : key;
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.conn.send('Input.dispatchKeyEvent', Object.assign({ type: single ? 'keyDown' : 'rawKeyDown', text: single ? key : undefined }, base));
    if (opts.holdMs) await sleep(opts.holdMs);
    await this.conn.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }
  /** Several key presses gapMs apart, without waiting for page round-trips between them. */
  async keys(list, gapMs = 30) {
    const ps = [];
    for (let i = 0; i < list.length; i++) { if (i) await sleep(gapMs); ps.push(this.key(list[i])); }
    await Promise.all(ps);
  }

  /** Timestamped touch gesture. pts = [{x,y,t}] (t = ms offset from start). Moves are scheduled on a
   *  drift-corrected clock and sent WITHOUT awaiting each round-trip (batched/pipelined), each carrying an
   *  explicit timestamp, so the page sees a steady ~60 Hz stream instead of the old 15–30 Hz.
   *  Falls back to mouse events when touch emulation is off. */
  async gesture(pts, opts = {}) {
    if (!pts.length) return;
    const t0 = Date.now(), ps = [];
    const send = (type, p) => {
      const ts = (t0 + (p ? p.t : 0)) / 1000;
      if (this.touch) return this.conn.send('Input.dispatchTouchEvent', { type, timestamp: ts, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
      const mt = type === 'touchStart' ? 'mousePressed' : type === 'touchEnd' ? 'mouseReleased' : 'mouseMoved';
      return this.conn.send('Input.dispatchMouseEvent', { type: mt, x: p.x, y: p.y, timestamp: ts, button: 'left', buttons: mt === 'mouseReleased' ? 0 : 1, clickCount: mt === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
    };
    if (!this.touch) await this._mouse('mouseMoved', pts[0].x, pts[0].y, 0);
    ps.push(send('touchStart', pts[0]));
    for (let i = 1; i < pts.length; i++) {
      const wait = t0 + pts[i].t - Date.now(); if (wait > 0) await sleep(wait);
      ps.push(send('touchMove', pts[i]));
    }
    const last = pts[pts.length - 1];
    const wait = t0 + last.t + (opts.holdEndMs || 0) - Date.now(); if (wait > 0) await sleep(wait);
    if (this.touch) ps.push(this.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: (t0 + last.t + (opts.holdEndMs || 0)) / 1000, touchPoints: [] }));
    else ps.push(send('touchEnd', last));
    await Promise.all(ps);
  }
  /** Linear (or eased) swipe at hz (default 60) via gesture(). opts {durationMs=300, hz=60, ease, holdEndMs} */
  async swipe(x1, y1, x2, y2, opts = {}) {
    const dur = opts.durationMs || 300, hz = opts.hz || 60, n = Math.max(2, Math.round(dur * hz / 1000));
    const ease = opts.ease || (k => k);
    const pts = []; for (let i = 0; i <= n; i++) { const k = ease(i / n); pts.push({ x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k, t: dur * i / n }); }
    await this.gesture(pts, opts);
  }
  /** Two-finger tap (undo gesture). */
  async twoFingerTap(x, y, holdMs = 80, sep = 40) {
    const P = [{ x: x - sep / 2, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }, { x: x + sep / 2, y, id: 2, radiusX: 4, radiusY: 4, force: 1 }];
    const t0 = Date.now();
    const a = this.conn.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0 / 1000, touchPoints: P });
    const wait = t0 + holdMs - Date.now(); if (wait > 0) await sleep(wait);
    const b = this.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: (t0 + holdMs) / 1000, touchPoints: [] });
    await Promise.all([a, b]);
  }

  /** rAF frame trace. sample = page-side JS expression evaluated every frame that returns an ARRAY of `width`
   *  numbers. Uses window.Game.onFrame (runs after the game's update+render) when available, else
   *  requestAnimationFrame. Storage is preallocated typed arrays. stopFrameTrace() -> {width, n, t:[ms], rows:[[...]], err} */
  async startFrameTrace(sample, opts = {}) {
    const width = opts.width || 1, max = opts.maxFrames || 20000;
    await this.evaluate('(()=>{ const W=' + width + ', MAX=' + max + ';' +
      'const T = window.__ft = { W, MAX, n: 0, t: new Float64Array(MAX), d: new Float64Array(MAX * W), on: true, off: null };' +
      'const f = () => { try { const v = (' + sample + '); const k = T.n; if (k < MAX) { T.t[k] = performance.now(); for (let i = 0; i < W; i++) T.d[k * W + i] = +v[i]; T.n++; } } catch (e) { T.err = String(e && e.message || e); } };' +
      'if (window.Game && typeof Game.onFrame === "function") T.off = Game.onFrame(f);' +
      'else { const loop = () => { if (!T.on) return; f(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); T.off = () => { T.on = false; }; }' +
      'return true; })()');
  }
  async stopFrameTrace() {
    return this.evaluate('(()=>{ const T = window.__ft; if (!T) return null; if (T.off) T.off(); T.on = false;' +
      'const rows = []; for (let k = 0; k < T.n; k++) rows.push(Array.from(T.d.subarray(k * T.W, k * T.W + T.W)));' +
      'const out = { width: T.W, n: T.n, t: Array.from(T.t.subarray(0, T.n)), rows, err: T.err || null }; window.__ft = null; return out; })()', 60000);
  }

  /** Forced GC + JS heap usage {usedSize, totalSize} (bytes). */
  async heap() {
    await this.conn.send('HeapProfiler.collectGarbage').catch(() => {});
    return this.conn.send('Runtime.getHeapUsage');
  }
  /** Chrome performance metrics as an object (JSHeapUsedSize, TaskDuration, …). */
  async metrics() {
    await this.conn.send('Performance.enable').catch(() => {});
    const r = await this.conn.send('Performance.getMetrics');
    const o = {}; for (const m of r.metrics) o[m.name] = m.value; return o;
  }

  async screenshot(file) {
    const r = await this.conn.send('Page.captureScreenshot', { format: 'png' }, 60000);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  /** console.error / console.assert, uncaught exceptions and Log entries of level error. */
  errors() { return this.logs.filter(l => l.level === 'error'); }
  exceptions() { return this.logs.filter(l => l.kind === 'exception'); }
  formatLog(l) { return l.kind + '/' + l.level + ': ' + l.text + (l.url ? '  @' + String(l.url).split('/').pop() + (l.line ? ':' + l.line : '') : ''); }

  /** Kill Chrome and remove the temp profile. Safe to call more than once. */
  async close() {
    if (this.closed) return; this.closed = true;
    await closeInstance(this.inst, this.browser);
  }
}

async function closeInstance(inst, browserConn) {
  if (inst.closing) return inst.closing;
  inst.closing = (async () => {
    if (browserConn && !browserConn.closed) {
      try { await browserConn.send('Browser.close', {}, 3000); } catch (_) {}
      browserConn.close();
    }
    const end = Date.now() + 4000;
    while (!inst.exited && Date.now() < end) await sleep(50);
    if (!inst.exited) killTreeSync(inst);
    const end2 = Date.now() + 3000;
    while (!inst.exited && Date.now() < end2) await sleep(50);
    // Windows: child processes may hold the profile a moment longer.
    for (let i = 0; i < 40; i++) {
      try { fs.rmSync(inst.dir, { recursive: true, force: true }); } catch (_) {}
      if (!fs.existsSync(inst.dir)) break;
      if (i === 10) killTreeSync(Object.assign({}, inst, { exited: false }));
      await sleep(150);
    }
    live.delete(inst);
  })();
  return inst.closing;
}

async function readDevToolsPort(dir, inst, timeoutMs) {
  const f = path.join(dir, 'DevToolsActivePort');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (inst.exited) throw new Error('Chrome exited early (code ' + inst.exitCode + '). stderr:\n' + inst.stderr.slice(-2000));
    try {
      const txt = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
      if (txt.length >= 2 && +txt[0] > 0) return { port: +txt[0], wsPath: txt[1] };
    } catch (_) {}
    await sleep(50);
  }
  throw new Error('Timed out waiting for DevToolsActivePort. stderr:\n' + inst.stderr.slice(-2000));
}

/** Launch headless Chrome and return a connected Page.
 *  opts: {width=1280,height=800,mobile=false,touch=false,dpr=1,timeoutMs=30000,extraArgs=[]} */
async function launch(opts = {}) {
  const o = Object.assign({ width: 1280, height: 800, mobile: false, touch: false, dpr: 1, timeoutMs: 30000, extraArgs: [] }, opts);
  const exe = o.chrome || findChrome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltcdp-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + dir,
    '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
    ...(o.allowFileAccess === false ? [] : ['--allow-file-access-from-files']),
    ...(o.autoplay === false ? [] : ['--autoplay-policy=no-user-gesture-required']),
    '--mute-audio', '--hide-scrollbars',
    '--enable-precise-memory-info',
    '--window-size=' + o.width + ',' + o.height,
    ...o.extraArgs,
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  const inst = { proc, pid: proc.pid, dir, exited: false, exitCode: null, stderr: '' };
  live.add(inst);
  proc.on('exit', code => { inst.exited = true; inst.exitCode = code; });
  proc.on('error', e => { inst.exited = true; inst.stderr += '\nspawn error: ' + e.message; });
  proc.stderr.on('data', d => { inst.stderr = (inst.stderr + d.toString()).slice(-8000); });

  let browser = null;
  try {
    const { port, wsPath } = await readDevToolsPort(dir, inst, o.timeoutMs);
    browser = await new Conn('ws://127.0.0.1:' + port + wsPath).open();
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await sleep(100);
    }
    if (!target) target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    const conn = await new Conn(target.webSocketDebuggerUrl).open();
    const page = new Page(inst, browser, conn, o);
    page.port = port; page.userDataDir = dir; page.pid = proc.pid; page.executable = exe;
    await page._init();
    return page;
  } catch (e) {
    await closeInstance(inst, browser);
    throw e;
  }
}

module.exports = { launch, fileUrl, sleep, findChrome, _live: live };
