'use strict';

// Checks that content/schema.json and the templates agree.
//
//   node build/validate.js         report problems, exit non-zero on failure
//   node build/validate.js --list  print the field paths each template reads
//
// Four classes of problem are reported:
//   missing  — a template reads a field the schema does not describe
//   orphan   — the schema describes a field no template reads
//   content  — a content file breaks a schema rule (required / maxLength / type)
//   howto    — structured data claims a different number of steps than the page shows

const fs = require('fs');
const path = require('path');
const { compile } = require('./render');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'templates');
const CONTENT = path.join(ROOT, 'content');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = (file) => fs.readFileSync(file, 'utf8');

// Scopes the build assembles itself, so templates read them but no schema field
// declares them. Matched against the first segment of a path.
const DERIVED_ROOTS = new Set(['canonical', 'nav', 'footerColumns', 'headerCtaHref', 'blocks', 'episodes']);

// Presentation flags the build attaches to each loop item. Matched against the
// last segment, since they appear inside content-owned lists.
const DERIVED_LOCALS = new Set([
  'iconSvg',
  'current',
  'isPlain',
  'isBold',
  'isItalic',
  'isCode',
  'isLink',
  'isHeading',
  'isParagraph',
  'isPrompt',
  'spaceBefore',
]);

const DERIVED_EXACT = new Set(['meta.canonical', 'meta.ogType', 'meta.ogUrl', 'site.contactDomain']);

// The mirror image: schema fields the build reads and reshapes, so no template
// names them directly. Prefix match, so "site.nav" covers "site.nav[].label".
const BUILD_CONSUMED = [
  'slug',
  'blocks',
  'site.nav',
  'site.footer.columns',
  'site.headerCta.href',
  'site.headerCta.hrefOnOwnPage',
];

// Leaves the build turns into presentation flags: an icon name becomes iconSvg,
// a run style becomes isBold / isItalic / isCode / isLink.
const RESHAPED = [/(^|\.)icon$/, /runs\[\]\.style$/];

function isBuildConsumed(p) {
  if (RESHAPED.some((re) => re.test(p))) return true;
  return BUILD_CONSUMED.some((c) => p === c || p.startsWith(`${c}.`) || p.startsWith(`${c}[]`));
}

// A list of bare strings is declared with a single unnamed item field.
function scalarItem(field) {
  const items = field.itemFields;
  return items && items.length === 1 && items[0].key === '' ? items[0] : null;
}

// ------------------------------------------------------------- template scan

function partialAsts() {
  const dir = path.join(TEMPLATES, 'partials');
  const out = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.html')) continue;
    const name = file.replace(/\.html$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[name] = compile(readText(path.join(dir, file)));
  }
  return out;
}

function collectPaths(nodes, partials, prefix, found, seen) {
  for (const node of nodes) {
    if (node.type === 'output' || node.type === 'if' || node.type === 'unless') {
      const p = node.path;
      // A bare "." inside a loop reads the item itself, i.e. the prefix.
      if (p && !p.startsWith('@') && (join(prefix, p) || '') !== '') found.add(join(prefix, p));
    }
    if (node.type === 'if' || node.type === 'unless') {
      collectPaths(node.children, partials, prefix, found, seen);
      collectPaths(node.alternate, partials, prefix, found, seen);
    } else if (node.type === 'each') {
      found.add(join(prefix, node.path));
      collectPaths(node.children, partials, `${join(prefix, node.path)}[]`, found, seen);
    } else if (node.type === 'partial') {
      const key = `${node.name}@${prefix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collectPaths(partials[node.name], partials, prefix, found, seen);
    }
  }
}

function join(prefix, p) {
  if (p === '.' || p === 'this') return prefix;
  return prefix ? `${prefix}.${p}` : p;
}

function templateFields(name, partials) {
  const found = new Set();
  collectPaths(compile(readText(path.join(TEMPLATES, 'pages', `${name}.html`))), partials, '', found, new Set());
  // "a.b" implies "a", and loop bodies may read a bare "." — drop derived and
  // site.* (site.json is described by its own schema section).
  return [...found]
    .filter((p) => !isDerived(p))
    .sort();
}

function isDerived(p) {
  if (DERIVED_EXACT.has(p)) return true;
  if (DERIVED_ROOTS.has(p.split('.')[0].replace(/\[\]$/, ''))) return true;
  return DERIVED_LOCALS.has(p.split('.').pop().replace(/\[\]$/, ''));
}

// --------------------------------------------------------------- schema scan

function schemaFields(fields, prefix, out) {
  for (const field of fields) {
    const p = join(prefix, field.key);
    if (field.type === 'group') schemaFields(field.fields, p, out);
    else if (field.type === 'list' && scalarItem(field)) out.add(`${p}[]`);
    else if (field.type === 'list' && field.itemFields) schemaFields(field.itemFields, `${p}[]`, out);
    else out.add(p);
    if (field.type === 'list') out.add(p);
  }
  return out;
}

// ------------------------------------------------------------ content checks

function checkValue(value, field, where, problems) {
  if (value === undefined || value === null || value === '') {
    if (field.required) problems.push(`content: ${where} is required but empty`);
    return;
  }
  if (field.type === 'list') {
    if (!Array.isArray(value)) return problems.push(`content: ${where} must be a list`);
    if (field.minItems && value.length < field.minItems) {
      problems.push(`content: ${where} has ${value.length} items, minimum ${field.minItems}`);
    }
    if (field.maxItems && value.length > field.maxItems) {
      problems.push(`content: ${where} has ${value.length} items, maximum ${field.maxItems}`);
    }
    const scalar = scalarItem(field);
    if (scalar) {
      value.forEach((item, i) => checkValue(item, scalar, `${where}[${i}]`, problems));
    } else if (field.itemFields) {
      value.forEach((item, i) => checkFields(field.itemFields, item, `${where}[${i}]`, problems));
    }
    return;
  }
  if (field.type === 'group') return checkFields(field.fields, value, where, problems);
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') problems.push(`content: ${where} must be true or false`);
    return;
  }
  if (typeof value !== 'string') return problems.push(`content: ${where} must be text`);
  if (field.maxLength && value.length > field.maxLength) {
    problems.push(`content: ${where} is ${value.length} characters, maximum ${field.maxLength}`);
  }
  if (field.type === 'select' && field.options && !field.options.some((o) => o.value === value)) {
    problems.push(`content: ${where} is "${value}", not one of the allowed options`);
  }
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    problems.push(`content: ${where} must be a YYYY-MM-DD date`);
  }
  // contactEmail is interpolated into an inline script, so a stray quote would
  // break the page rather than just look wrong.
  if (field.type === 'email' && !/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(value)) {
    problems.push(`content: ${where} is not a valid email address`);
  }
}

function checkFields(fields, data, where, problems) {
  const object = data || {};
  for (const field of fields) {
    checkValue(object[field.key], field, `${where}.${field.key}`, problems);
  }
}

// ------------------------------------------------------- structured data drift
//
// The JSON-LD HowTo lives in its own `howTo` / `seo.howTo` group rather than
// being generated from the visible sections, because the two are not always
// worded the same and regenerating them would change the published markup.
// That independence is the hazard: an editor can rename, add or delete a
// numbered section and leave Google reading a recipe the page no longer
// contains. Nothing renders differently, so the drift is invisible on the page
// and only shows up in search. Counting both sides catches it at build time.
//
// A visible section is a heading block numbered "1. ", "2) " and so on;
// unnumbered headings ("Watch out for") are commentary, not steps.

const NUMBERED_HEADING = /^\d+[.)]\s/;

function checkHowTo(label, declared, visible, problems) {
  if (!declared || declared.length === visible.length) return;
  problems.push(
    `howto: ${label} declares ${declared.length} structured-data step(s) ` +
      `but the page shows ${visible.length} numbered section(s) — ` +
      `Google would be told about a step readers cannot see`
  );
}

function checkStructuredData(schema, problems) {
  const playbooksPage = readJson(path.join(CONTENT, 'pages', 'playbooks.json'));
  checkHowTo(
    'pages/playbooks.json',
    playbooksPage.seo && playbooksPage.seo.howTo && playbooksPage.seo.howTo.steps,
    (playbooksPage.startHere && playbooksPage.startHere.steps) || [],
    problems
  );

  const dir = path.join(CONTENT, 'collections', 'playbooks');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const item = readJson(path.join(dir, file));
    const headings = (item.blocks || [])
      .filter((b) => b.type === 'heading' && NUMBERED_HEADING.test(b.heading || ''));
    checkHowTo(`collections/playbooks/${file}`, item.howTo && item.howTo.steps, headings, problems);
  }
}

// Block types share one list, so the schema cannot say which field each type
// requires. Enforce it here instead.
const BLOCK_SHAPE = { heading: 'heading', paragraph: 'runs', prompt: 'prompt' };

function checkBlocks(blocks, where, problems) {
  (blocks || []).forEach((block, i) => {
    const key = BLOCK_SHAPE[block.type];
    if (!key) return; // an unknown type is already reported by the select check
    const value = block[key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      problems.push(`content: ${where}.blocks[${i}] is a ${block.type} block but has no ${key}`);
    }
  });
}

// -------------------------------------------------------------------- driver

function main() {
  const partials = partialAsts();
  const schema = readJson(path.join(CONTENT, 'schema.json'));
  const problems = [];

  const sections = [
    { fields: schema.site.fields, templates: [], label: schema.site.file },
    ...schema.pages.map((p) => ({ fields: p.fields, templates: [p.template], label: p.file })),
    ...schema.collections.map((c) => ({ fields: c.fields, templates: [c.template], label: c.folder })),
  ];

  if (process.argv.includes('--list')) {
    for (const page of [...schema.pages, ...schema.collections]) {
      process.stdout.write(`\n# ${page.template}\n`);
      for (const p of templateFields(page.template, partials)) process.stdout.write(`  ${p}\n`);
    }
    return;
  }

  // Site fields are read from every template, so gather them once.
  const siteDeclared = schemaFields(schema.site.fields, 'site', new Set());
  const siteUsed = new Set();

  for (const section of sections) {
    if (!section.templates.length) continue;
    const used = new Set(templateFields(section.templates[0], partials));
    const declared = schemaFields(section.fields, '', new Set());

    for (const p of used) {
      if (p.startsWith('site.')) {
        siteUsed.add(p);
        if (!siteDeclared.has(p)) problems.push(`missing: ${p} used by ${section.templates[0]} but not in schema.site`);
        continue;
      }
      if (!declared.has(p)) problems.push(`missing: ${p} used by ${section.templates[0]} but not in ${section.label}`);
    }
    for (const p of declared) {
      if (used.has(p) || isBuildConsumed(p)) continue;
      problems.push(`orphan: ${p} declared for ${section.label} but no template reads it`);
    }
  }
  for (const p of siteDeclared) {
    if (siteUsed.has(p) || isBuildConsumed(p)) continue;
    problems.push(`orphan: ${p} declared in schema.site but no template reads it`);
  }

  // Content files must satisfy their own schema section.
  checkFields(schema.site.fields, readJson(path.join(CONTENT, schema.site.file)), schema.site.file, problems);
  for (const page of schema.pages) {
    checkFields(page.fields, readJson(path.join(CONTENT, page.file)), page.file, problems);
  }
  for (const collection of schema.collections) {
    const dir = path.join(CONTENT, collection.folder);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
    if (collection.maxItems && files.length > collection.maxItems) {
      problems.push(`content: ${collection.folder} has ${files.length} items, maximum ${collection.maxItems}`);
    }
    for (const file of files) {
      const item = readJson(path.join(dir, file));
      const where = `${collection.folder}/${file}`;
      checkFields(collection.fields, item, where, problems);
      checkBlocks(item.blocks, where, problems);
    }
  }

  checkStructuredData(schema, problems);

  if (problems.length) {
    for (const p of problems.sort()) process.stderr.write(`${p}\n`);
    process.stderr.write(`\n${problems.length} problem(s)\n`);
    process.exit(1);
  }
  process.stdout.write('schema.json, templates and content agree\n');
}

main();
