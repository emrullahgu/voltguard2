'use strict';

// Scope legacy calculator CSS without changing declarations, print templates,
// animation frames or font definitions. No build-time dependencies are needed.
const WORKSPACE = '#vg-tool-workspace';
const PREFIX = ':where(' + WORKSPACE + ')';
const GROUP_RULES = new Set(['media', 'supports', 'container', 'layer', 'document', '-moz-document', 'scope', 'starting-style']);

function walkTokens(text, visit) {
  let quote = '', comment = false, parentheses = 0, brackets = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment) {
      if (c === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (visit(c, i, parentheses, brackets) === false) return i;
    if (c === '(') parentheses++;
    else if (c === ')') parentheses--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }
  return text.length;
}

function splitSelectors(selectors) {
  const pieces = []; let from = 0;
  walkTokens(selectors, (c, i, parentheses, brackets) => {
    if (c === ',' && !parentheses && !brackets) { pieces.push(selectors.slice(from, i)); from = i + 1; }
  });
  pieces.push(selectors.slice(from));
  return pieces;
}

function firstCompound(selector) {
  const end = walkTokens(selector, (c, i, parentheses, brackets) => {
    if (!parentheses && !brackets && /[\s>+~]/.test(c)) return false;
  });
  return [selector.slice(0, end), selector.slice(end)];
}

function scopeSelector(selector) {
  // Keep comments in place; some source styles start with attribution comments.
  const start = selector.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/)[0];
  const end = selector.match(/\s*$/)[0];
  let value = selector.slice(start.length, selector.length - end.length || undefined);
  if (!value) return selector;
  const [compound, remainder] = firstCompound(value);
  const root = compound.match(/^(html|body|:root)(?=$|[.#:\[])/i);
  if (!root) return start + PREFIX + ' ' + value + end;

  const element = root[1].toLowerCase(), suffix = compound.slice(root[0].length);
  // Real body classes are still toggled by the calculators' original scripts.
  // Putting the condition outside the workspace keeps those print states live.
  if (element === 'body' && suffix) return start + compound + ' ' + PREFIX + remainder + end;

  // html body and html > body both described the one native document root.
  // They now describe the one calculator workspace rather than two wrappers.
  if ((element === 'html' || element === ':root') && !suffix) {
    const nestedBody = remainder.match(/^\s*(?:>\s*)?body(?=$|[\s>+~.#:\[])/i);
    if (nestedBody) return start + scopeSelector(remainder.slice(nestedBody[0].length - 4).trim()) + end;
  }
  value = WORKSPACE + suffix.replace(/:root\b/g, '') + remainder;
  return start + value + end;
}

function scopeCss(css) {
  if (typeof css !== 'string') throw new TypeError('scopeCss expects a CSS string');
  let result = '', cursor = 0;
  while (cursor < css.length) {
    const rest = css.slice(cursor);
    const delimiter = walkTokens(rest, (c, i, parentheses, brackets) => {
      if (!parentheses && !brackets && (c === '{' || c === ';')) return false;
    });
    if (delimiter === rest.length) { result += rest; break; }
    if (rest[delimiter] === ';') {
      result += rest.slice(0, delimiter + 1); cursor += delimiter + 1; continue;
    }
    const prelude = rest.slice(0, delimiter);
    let depth = 1;
    const afterOpen = rest.slice(delimiter + 1);
    const closing = walkTokens(afterOpen, (c, i, parentheses, brackets) => {
      if (parentheses || brackets) return;
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return false;
    });
    // A malformed source rule must not silently swallow the rest of a tool.
    if (closing === afterOpen.length) throw new SyntaxError('Unclosed CSS block');
    const body = afterOpen.slice(0, closing);
    const meaningful = prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const atRule = meaningful.match(/^@([\w-]+)/);
    if (atRule) result += prelude + '{' + (GROUP_RULES.has(atRule[1].toLowerCase()) ? scopeCss(body) : body) + '}';
    else result += splitSelectors(prelude).map(scopeSelector).join(',') + '{' + body + '}';
    cursor += delimiter + closing + 2;
  }
  return result;
}

module.exports = { scopeCss, scopeSelector, splitSelectors };
