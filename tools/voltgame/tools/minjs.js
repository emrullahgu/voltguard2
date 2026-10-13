'use strict';
// Parser-based JavaScript compression. Public properties and globals are preserved.
const vm = require('vm');
const terser = require('terser');
const acorn = require('./vendor/acorn.js');

function minify(src, name, opts) {
  opts = opts || {};
  try {
    // A declaration retains the wrapper while allowing its local bindings to be
    // compressed; extraction uses the parsed body rather than fixed text offsets.
    const input = opts.local ? "function __PXModule(PX){'use strict';\n" + src + '\n}' : src;
    const syntax = acorn.parse(input, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
    // Parameter initializers have a scope outside the function body. Preserve it
    // conservatively: the compressor/mangler can confuse shadowed body bindings.
    let parameterScope = false;
    function parameterExpression(n) {
      if (!n || typeof n !== 'object') return false;
      if (n.type === 'AssignmentPattern' || n.type === 'Property' && n.computed) return true;
      return Object.values(n).some(v => Array.isArray(v) ? v.some(parameterExpression) : v && typeof v === 'object' && parameterExpression(v));
    }
    function inspect(n) {
      if (!n || typeof n !== 'object') return;
      if (/^(Function|ArrowFunction)/.test(n.type || '') && n.params.some(parameterExpression)) parameterScope = true;
      for (const v of Object.values(n)) { if (Array.isArray(v)) v.forEach(inspect); else if (v && typeof v === 'object') inspect(v); }
    }
    inspect(syntax);
    const r = terser.minify_sync(input, {
      compress: parameterScope ? false : { passes: 2, unsafe: false },
      mangle: !parameterScope && opts.local && opts.mangle !== false ? { reserved: ['PX'] } : false,
      format: { comments: /^!|^#/, ascii_only: false, quote_style: 1 },
    });
    let m = r.code;
    if (opts.local) {
      const ast = acorn.parse(m, { ecmaVersion: 'latest' });
      const body = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === '__PXModule').body;
      m = m.slice(body.start + 1, body.end - 1);
    }
    new vm.Script('(function(PX){\n' + m + '\n})', { filename: name || 'min.js' });
    return { src: m + '\n', ok: true };
  } catch (e) { return { src, ok: false, why: e.message }; }
}
function strip(src) { const r = minify(src); if (!r.ok) throw new Error(r.why); return r.src; }
module.exports = { strip, minify };
