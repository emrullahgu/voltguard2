'use strict';
// ============================================================================
// tools/mangle.js — kapsam bilinçli yerel ad kısaltıcı (build --v2, §17/§24.5 JS bütçesi ≤ 450 KB)
// Ayrıştırıcı: tools/vendor/acorn.js (acorn 8, MIT; tools/vendor/acorn.LICENSE).
// Yalnız YEREL bağları (var/let/const/function/class/param/catch) yeniden adlandırır; özellik adları, küresel/serbest
// adlar (PX, THREE, window, Math, arguments …) ve en dıştaki sarmal fonksiyonun parametreleri (PX) asla değişmez.
// Kısa nesne özellikleri ({a} / {a = 1} desenleri) "a: yeniAd" biçimine açılır. Kod 'use strict' sarmalında
// çalıştığı için blok içindeki function bildirimleri blok kapsamlıdır. eval/with içeren kapsamlar dokunulmadan kalır.
//   mangle(src) -> src'      (src: sarılmış ya da sarılmamış betik; çıktı yeniden ayrıştırılarak doğrulanır)
// ============================================================================
const acorn = require('./vendor/acorn.js');

const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if ' +
  'import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package ' +
  'private protected public await async of get set undefined NaN Infinity arguments eval').split(' '));
const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const ALNUM = ALPHA + '0123456789';
function nameAt(i) {
  let s = ALPHA[i % ALPHA.length]; i = Math.floor(i / ALPHA.length);
  while (i > 0) { i--; s += ALNUM[i % ALNUM.length]; i = Math.floor(i / ALNUM.length); }
  return s;
}

class Scope {
  constructor(parent, isFn) { this.parent = parent; this.isFn = isFn; this.decl = new Map(); this.kids = []; this.through = new Set(); this.fixed = false; this.unsafe = false; if (parent) parent.kids.push(this); }
  fnScope() { let s = this; while (!s.isFn) s = s.parent; return s; }
  declare(name, fixed) { let b = this.decl.get(name); if (!b) { b = { name, scope: this, refs: 0, fixed: !!fixed, nu: null }; this.decl.set(name, b); } else if (fixed) b.fixed = true; return b; }
  resolve(name) { for (let s = this; s; s = s.parent) { const b = s.decl.get(name); if (b) return b; } return null; }
}

function isNode(x) { return x && typeof x.type === 'string'; }

function mangle(src, opts) {
  opts = opts || {};
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
  const root = new Scope(null, true); root.isRoot = true;
  const occ = [];                       // {node, scope, shorthand?: keyName}
  const scopeOf = new Map();            // fonksiyon/blok düğümü -> kapsam
  let outerFnSeen = false;

  // ---- 1. geçiş: kapsamlar ve bildirimler
  function bindPattern(p, scope, cb) {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': cb(p, scope); break;
      case 'ObjectPattern': for (const pr of p.properties) { if (pr.type === 'RestElement') bindPattern(pr.argument, scope, cb); else bindPattern(pr.value, scope, cb); } break;
      case 'ArrayPattern': for (const e of p.elements) if (e) bindPattern(e, scope, cb); break;
      case 'RestElement': bindPattern(p.argument, scope, cb); break;
      case 'AssignmentPattern': bindPattern(p.left, scope, cb); break;
      default: break;          // MemberExpression (atama hedefi) — bağ değil
    }
  }
  function declareIn(scope, fixed) { return id => scope.declare(id.name, fixed); }

  function hoistVars(node, fnScope) {   // fonksiyon gövdesindeki var bildirimleri (iç fonksiyonlara girmeden)
    const visit = n => {
      if (!isNode(n)) return;
      if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'ClassBody') return;
      if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) bindPattern(d.id, fnScope, declareIn(fnScope));
      for (const k in n) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(visit); else if (isNode(v)) visit(v); }
    };
    visit(node);
  }
  function lexicalDecls(stmts, scope) {   // blok başında let/const/class/function (strict: blok kapsamlı)
    for (const st of stmts) {
      if (st.type === 'VariableDeclaration' && st.kind !== 'var') for (const d of st.declarations) bindPattern(d.id, scope, declareIn(scope));
      else if (st.type === 'FunctionDeclaration' && st.id) scope.declare(st.id.name);
      else if (st.type === 'ClassDeclaration' && st.id) scope.declare(st.id.name);
    }
  }

  function walk(n, scope, parent, key) {
    if (!isNode(n)) return;
    switch (n.type) {
      case 'Identifier': occ.push({ node: n, scope }); return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        if (n.type === 'FunctionDeclaration' && n.id) occ.push({ node: n.id, scope });
        const fs = new Scope(scope, true); scopeOf.set(n, fs);
        const outer = !outerFnSeen && scope === root; if (outer) outerFnSeen = true;
        if (n.type === 'FunctionExpression' && n.id) { fs.declare(n.id.name); occ.push({ node: n.id, scope: fs }); }
        for (const p of n.params) bindPattern(p, fs, declareIn(fs, outer));       // en dış sarmalın parametreleri (PX) sabit
        for (const p of n.params) walk(p, fs, n, 'params');
        if (n.body.type === 'BlockStatement') { hoistVars(n.body, fs); lexicalDecls(n.body.body, fs); for (const st of n.body.body) walk(st, fs, n.body, 'body'); }
        else walk(n.body, fs, n, 'body');
        return;
      }
      case 'ClassDeclaration': case 'ClassExpression': {
        if (n.type === 'ClassDeclaration' && n.id) occ.push({ node: n.id, scope });
        if (n.superClass) walk(n.superClass, scope, n, 'superClass');
        const cs = new Scope(scope, false);
        // sınıf ifadesinin adı yalnız gövdede görünür (kendi bağı); sınıf bildirimi dış bağı kullanır (iç takma ad yok)
        if (n.id && n.type === 'ClassExpression') { cs.declare(n.id.name); occ.push({ node: n.id, scope: cs }); }
        walk(n.body, cs, n, 'body'); return;
      }
      case 'BlockStatement': case 'StaticBlock': {
        const bs = new Scope(scope, n.type === 'StaticBlock'); scopeOf.set(n, bs);
        if (n.type === 'StaticBlock') hoistVars(n, bs);
        lexicalDecls(n.body, bs); for (const st of n.body) walk(st, bs, n, 'body'); return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const fsc = new Scope(scope, false);
        const init = n.type === 'ForStatement' ? n.init : n.left;
        if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') for (const d of init.declarations) bindPattern(d.id, fsc, declareIn(fsc));
        for (const k of ['init', 'left', 'test', 'update', 'right', 'body']) if (n[k]) walk(n[k], fsc, n, k);
        return;
      }
      case 'SwitchStatement': {
        walk(n.discriminant, scope, n, 'discriminant');
        const ss = new Scope(scope, false); const all = []; for (const c of n.cases) all.push(...c.consequent);
        lexicalDecls(all, ss);
        for (const c of n.cases) { if (c.test) walk(c.test, ss, c, 'test'); for (const st of c.consequent) walk(st, ss, c, 'consequent'); }
        return;
      }
      case 'CatchClause': {
        const cs = new Scope(scope, false);
        if (n.param) { bindPattern(n.param, cs, declareIn(cs)); walk(n.param, cs, n, 'param'); }
        // gövde bloğu kendi kapsamını açar (catch param'ı gölgeleyebilir)
        walk(n.body, cs, n, 'body'); return;
      }
      case 'MemberExpression': walk(n.object, scope, n, 'object'); if (n.computed) walk(n.property, scope, n, 'property'); return;
      case 'Property': {
        if (n.computed) walk(n.key, scope, n, 'key');
        if (n.shorthand) {
          // {a} / {a = 1}: değer tarafı ad; yeniden adlandırılırsa "a: yeni" olarak açılır
          const v = n.value;
          if (v.type === 'Identifier') { occ.push({ node: v, scope, shorthand: n.key.name }); return; }
          if (v.type === 'AssignmentPattern' && v.left.type === 'Identifier') { occ.push({ node: v.left, scope, shorthand: n.key.name }); walk(v.right, scope, v, 'right'); return; }
        }
        walk(n.value, scope, n, 'value'); return;
      }
      case 'MethodDefinition': case 'PropertyDefinition': if (n.computed) walk(n.key, scope, n, 'key'); if (n.value) walk(n.value, scope, n, 'value'); return;
      case 'LabeledStatement': walk(n.body, scope, n, 'body'); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'MetaProperty': return;
      case 'CallExpression':
        if (n.callee.type === 'Identifier' && n.callee.name === 'eval') for (let s = scope; s; s = s.parent) s.unsafe = true;
        break;
      case 'WithStatement': for (let s = scope; s; s = s.parent) s.unsafe = true; break;
      case 'ImportExpression': case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration': case 'ExportAllDeclaration':
        throw new Error('mangle: modül sözdizimi desteklenmiyor');
      default: break;
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = n[k]; if (Array.isArray(v)) { for (const x of v) walk(x, scope, n, k); } else if (isNode(v)) walk(v, scope, n, k);
    }
  }
  // program düzeyi: betik küreseldir — en üst düzey bildirimler küresel kalır (sabit)
  hoistVars(ast, root); lexicalDecls(ast.body, root);
  for (const b of root.decl.values()) b.fixed = true;
  for (const st of ast.body) walk(st, root, ast, 'body');

  // ---- 2. geçiş: çözümleme ve "içinden geçen" adlar
  const free = new Set();
  for (const o of occ) {
    const b = o.scope.resolve(o.node.name); o.b = b;
    if (b) { b.refs++; for (let s = o.scope; s && s !== b.scope; s = s.parent) s.through.add(b); }
    else { free.add(o.node.name); for (let s = o.scope; s; s = s.parent) s.through.add(o.node.name); }
  }
  // ---- 3. ad ataması (yukarıdan aşağı)
  const assign = s => {
    const forbid = new Set();
    for (const t of s.through) forbid.add(typeof t === 'string' ? t : (t.nu || t.name));
    // bu kapsamın sabit bağları da kendi adlarını korur
    const binds = [...s.decl.values()];
    for (const b of binds) if (b.fixed || s.unsafe) { b.nu = b.name; forbid.add(b.name); }
    binds.filter(b => !b.nu).sort((x, y) => y.refs - x.refs).forEach(b => {
      let i = 0, nm; do { nm = nameAt(i++); } while (forbid.has(nm) || RESERVED.has(nm) || free.has(nm));
      b.nu = nm; forbid.add(nm);
    });
    for (const k of s.kids) assign(k);
  };
  assign(root);

  // ---- 4. çıktı
  const reps = [];
  for (const o of occ) {
    if (!o.b || o.b.nu === o.node.name) continue;
    reps.push([o.node.start, o.node.end, o.shorthand ? o.shorthand + ':' + o.b.nu : o.b.nu]);
  }
  reps.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [a, b, t] of reps) out = out.slice(0, a) + t + out.slice(b);
  acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });   // doğrulama
  return out;
}
module.exports = { mangle };
