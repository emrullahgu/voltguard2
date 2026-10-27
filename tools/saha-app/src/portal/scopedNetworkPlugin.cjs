// Only this bundle's own source gets scoped request helpers. Host globals stay untouched.
module.exports = function scopedNetworkPlugin({ types: t }) {
  const path = require('node:path');
  const sourceRoot = path.resolve(__dirname, '..');
  const policy = path.resolve(__dirname, 'networkPolicy.ts');
  const dimensions = path.resolve(__dirname, 'moduleDimensions.ts');
  return { visitor: { Program(program, state) {
    const filename = state.filename && path.resolve(state.filename);
    if (!filename || filename === policy || !filename.startsWith(sourceRoot + path.sep)) return;
    const dimensionBindings = [];
    for (const statement of program.get('body')) {
      if (!statement.isImportDeclaration() || statement.node.source.value !== 'react-native') continue;
      for (const specifier of statement.get('specifiers')) {
        if (specifier.isImportSpecifier() && specifier.node.imported.name === 'useWindowDimensions') {
          dimensionBindings.push(t.importSpecifier(t.cloneNode(specifier.node.local), t.identifier('useModuleDimensions')));
          specifier.remove();
        }
      }
    }
    if (dimensionBindings.length) program.unshiftContainer('body', t.importDeclaration(dimensionBindings, t.stringLiteral(dimensions)));
    const helpers = new Map();
    program.traverse({ ReferencedIdentifier(reference) {
      const name = reference.node.name;
      const exported = { fetch: 'scopedFetch', XMLHttpRequest: 'ScopedXMLHttpRequest', WebSocket: 'ScopedWebSocket' }[name];
      if (!exported || reference.scope.hasBinding(name)) return;
      let local = helpers.get(exported);
      if (!local) { local = program.scope.generateUidIdentifier(exported); helpers.set(exported, local); }
      reference.replaceWith(t.cloneNode(local));
    } });
    if (helpers.size) program.unshiftContainer('body', t.importDeclaration([...helpers].map(([name, local]) => t.importSpecifier(local, t.identifier(name))), t.stringLiteral(policy)));
  } } };
};
