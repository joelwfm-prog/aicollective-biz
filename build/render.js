'use strict';

// Minimal mustache-style renderer. No dependencies.
//
// Syntax
//   {{ path }}          text output, escapes & < >
//   {{ attr path }}     attribute output, escapes & < > "
//   {{{ path }}}        raw output (used only for template-owned markup)
//   {{{ json path }}}   JSON.stringify output (used inside JSON-LD blocks)
//   {{#if path}}…{{else}}…{{/if}}
//   {{#unless path}}…{{/unless}}
//   {{#each path}}…{{/each}}      exposes . @index @number @first @last
//   {{> partialName}}             must be alone on a line, at column 0
//
// A line containing nothing but a block tag is removed whole, so template
// indentation matches the HTML it produces.

const BLOCK_ONLY_LINE = /^[ \t]*\{\{[#/](?:[^}]*)\}\}[ \t]*\r?\n/gm;
const ELSE_ONLY_LINE = /^[ \t]*\{\{else\}\}[ \t]*\r?\n/gm;
const TAG = /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([^}]+?)\s*\}\}/g;

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function parse(source) {
  const trim = (line) => line.trim();
  const stripped = source.replace(BLOCK_ONLY_LINE, trim).replace(ELSE_ONLY_LINE, trim);
  const root = { children: [] };
  const stack = [root];
  let cursor = 0;
  let match;

  const target = () => {
    const open = stack[stack.length - 1];
    return open.inElse ? open.alternate : open.children;
  };

  TAG.lastIndex = 0;
  while ((match = TAG.exec(stripped)) !== null) {
    if (match.index > cursor) {
      target().push({ type: 'text', value: stripped.slice(cursor, match.index) });
    }
    cursor = match.index + match[0].length;

    if (match[1] !== undefined) {
      const raw = match[1].trim();
      if (raw.startsWith('json ')) {
        target().push({ type: 'output', mode: 'json', path: raw.slice(5).trim() });
      } else {
        target().push({ type: 'output', mode: 'raw', path: raw });
      }
      continue;
    }

    const expr = match[2];
    if (expr.startsWith('#if ') || expr.startsWith('#unless ') || expr.startsWith('#each ')) {
      const [keyword, ...rest] = expr.slice(1).split(/\s+/);
      const node = { type: keyword, path: rest.join(' '), children: [], alternate: [], inElse: false };
      target().push(node);
      stack.push(node);
    } else if (expr === 'else') {
      stack[stack.length - 1].inElse = true;
    } else if (expr.startsWith('/')) {
      stack.pop();
    } else if (expr.startsWith('>')) {
      target().push({ type: 'partial', name: expr.slice(1).trim() });
    } else if (expr.startsWith('attr ')) {
      target().push({ type: 'output', mode: 'attr', path: expr.slice(5).trim() });
    } else {
      target().push({ type: 'output', mode: 'text', path: expr });
    }
  }
  if (cursor < stripped.length) target().push({ type: 'text', value: stripped.slice(cursor) });
  if (stack.length !== 1) throw new Error('Unbalanced block tag in template');
  return root.children;
}

function resolve(path, scope) {
  let context = scope;
  let key = path;
  while (key.startsWith('../')) {
    context = context.parent;
    key = key.slice(3);
    if (!context) return undefined;
  }
  if (key === '.' || key === 'this') return context.data;
  if (key.startsWith('@')) return context.locals ? context.locals[key] : undefined;

  let value = context.data;
  for (const part of key.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  if (value === undefined && context.parent) return resolve(key, context.parent);
  return value;
}

function isTruthy(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function renderNodes(nodes, scope, partials) {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;
      case 'output': {
        const value = resolve(node.path, scope);
        if (value === undefined || value === null) break;
        if (node.mode === 'json') out += JSON.stringify(value);
        else if (node.mode === 'raw') out += String(value);
        else if (node.mode === 'attr') out += escapeAttr(value);
        else out += escapeText(value);
        break;
      }
      case 'if':
      case 'unless': {
        const truthy = isTruthy(resolve(node.path, scope));
        const take = node.type === 'if' ? truthy : !truthy;
        out += renderNodes(take ? node.children : node.alternate, scope, partials);
        break;
      }
      case 'each': {
        const items = resolve(node.path, scope) || [];
        items.forEach((item, index) => {
          const child = {
            data: item,
            parent: scope,
            locals: {
              '@index': index,
              '@number': index + 1,
              '@first': index === 0,
              '@last': index === items.length - 1,
            },
          };
          out += renderNodes(node.children, child, partials);
        });
        break;
      }
      case 'partial': {
        const partial = partials[node.name];
        if (!partial) throw new Error(`Unknown partial: ${node.name}`);
        out += renderNodes(partial, scope, partials);
        break;
      }
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }
  return out;
}

function compile(source) {
  return parse(source);
}

function render(nodes, data, partials) {
  return renderNodes(nodes, { data, parent: null, locals: {} }, partials || {});
}

module.exports = { compile, render, escapeText, escapeAttr };
