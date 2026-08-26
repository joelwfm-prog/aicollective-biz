'use strict';

// Renders templates/ + content/ into static HTML at the repo root.
// Run with: npm run build

const fs = require('fs');
const path = require('path');
const { compile, render } = require('./render');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'templates');
const CONTENT = path.join(ROOT, 'content');
const BASE_URL = 'https://aicollective.biz/';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = (file) => fs.readFileSync(file, 'utf8');

function loadPartials() {
  const dir = path.join(TEMPLATES, 'partials');
  const partials = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.html')) continue;
    const name = file.replace(/\.html$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    partials[name] = compile(readText(path.join(dir, file)));
  }
  return partials;
}

function loadTemplate(name) {
  return compile(readText(path.join(TEMPLATES, 'pages', `${name}.html`)));
}

// ---------------------------------------------------------------- collections

function loadCollection(key) {
  const dir = path.join(CONTENT, 'collections', key);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(path.join(dir, f)));
}

// -------------------------------------------------------------------- icons

// Icon artwork is presentation, so content only names an icon and the SVG paths
// are looked up here. This also keeps the editor limited to a known icon set.
const ICONS = readJson(path.join(TEMPLATES, 'icons.json'));

function resolveIcons(value) {
  if (Array.isArray(value)) return value.map(resolveIcons);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = resolveIcons(child);
  if (typeof value.icon === 'string') {
    if (!ICONS[value.icon]) throw new Error(`Unknown icon: ${value.icon}`);
    out.iconSvg = ICONS[value.icon];
  }
  return out;
}

// ------------------------------------------------------------------- prose

function decorateRuns(runs) {
  return (runs || []).map((run) => ({
    text: run.text,
    href: run.href,
    isPlain: !run.style || run.style === 'normal',
    isBold: run.style === 'bold',
    isItalic: run.style === 'italic',
    isCode: run.style === 'code',
    isLink: run.style === 'link',
  }));
}

function decorateRunsDeep(value) {
  if (Array.isArray(value)) return value.map(decorateRunsDeep);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === 'runs' ? decorateRuns(child) : decorateRunsDeep(child);
  }
  return out;
}

// Typographic rule the templates rely on: a blank line separates a heading from
// the block above it, and separates a standalone closing link from the article.
function decorateBlocks(blocks) {
  const list = blocks || [];
  return list.map((block, index) => {
    const isParagraph = block.type === 'paragraph';
    const runs = decorateRuns(block.runs);
    const linkOnly = isParagraph && runs.length === 1 && runs[0].isLink;
    return {
      heading: block.heading,
      prompt: block.prompt,
      runs,
      isHeading: block.type === 'heading',
      isParagraph,
      isPrompt: block.type === 'prompt',
      spaceBefore: index > 0 && (block.type === 'heading' || (linkOnly && index === list.length - 1)),
    };
  });
}

// -------------------------------------------------------------------- pages

const PAGES = [
  { out: 'index.html', template: 'index', content: 'index', navKey: null, ogType: 'website' },
  { out: 'latest.html', template: 'latest', content: 'latest', navKey: 'latest.html', ogType: 'website' },
  { out: 'playbooks.html', template: 'playbooks', content: 'playbooks', navKey: 'playbooks.html', ogType: 'website' },
  { out: 'podcast.html', template: 'podcast', content: 'podcast', navKey: 'podcast.html', ogType: 'website' },
  { out: 'ai-solutions.html', template: 'ai-solutions', content: 'ai-solutions', navKey: 'ai-solutions.html', ogType: 'website' },
  { out: 'about.html', template: 'about', content: 'about', navKey: 'about.html', ogType: 'website' },
];

const COLLECTIONS = [
  { key: 'playbooks', template: 'playbook', navKey: 'playbooks.html', ogType: 'article' },
  { key: 'newsletter', template: 'newsletter', navKey: 'latest.html', ogType: 'article' },
  { key: 'podcast', template: 'episode', navKey: 'podcast.html', ogType: 'article', subdir: 'podcast' },
];

// The homepage links to its own newsletter anchor as "#newsletter" rather than
// "index.html#newsletter"; every other page keeps the fully qualified href.
// Pages that live in a subdirectory (e.g. podcast/ep-01.html) can't use the
// root-relative hrefs the rest of the site shares, so their internal links are
// rewritten to site-absolute form (a leading slash).
function inSubdir(outFile) {
  return outFile.includes('/');
}

function absolutize(href, outFile) {
  if (!href || !inSubdir(outFile)) return href;
  // Leave anchors, absolute URLs, and already-absolute paths untouched.
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
  return `/${href}`;
}

function resolveHref(href, outFile) {
  if (!href) return href;
  if (outFile === 'index.html') {
    const [file, hash] = href.split('#');
    return file === outFile && hash ? `#${hash}` : href;
  }
  return absolutize(href, outFile);
}

function buildNav(site, navKey, outFile) {
  return site.nav.map((item) => ({ ...item, href: absolutize(item.href, outFile), current: item.href === navKey }));
}

function buildFooterColumns(site, outFile) {
  return site.footer.columns.map((column) => ({
    heading: column.heading,
    links: column.links.map((link) => ({ label: link.label, href: resolveHref(link.href, outFile) })),
  }));
}

function pageUrl(outFile) {
  return outFile === 'index.html' ? BASE_URL : BASE_URL + outFile;
}

function baseScope(site, page, outFile, navKey, ogType) {
  const canonical = pageUrl(outFile);
  return {
    site,
    nav: buildNav(site, navKey, outFile),
    footerColumns: buildFooterColumns(site, outFile),
    headerCtaHref: resolveHref(
      outFile === 'ai-solutions.html' ? site.headerCta.hrefOnOwnPage : site.headerCta.href,
      outFile
    ),
    canonical,
    meta: {
      title: page.meta.title,
      description: page.meta.description,
      canonical,
      ogTitle: page.meta.ogTitle,
      ogDescription: page.meta.ogDescription,
      ogType,
      ogUrl: canonical,
      twitterCard: page.meta.twitterCard,
    },
  };
}

function main() {
  const partials = loadPartials();
  const raw = readJson(path.join(CONTENT, 'site.json'));
  // The intake fallback shows the bare domain in prose but needs the full
  // address in its mailto, so only the address is editable.
  const site = Object.assign({}, raw, { contactDomain: raw.contactEmail.split('@').pop() });
  const written = [];

  // Episodes are listed ascending on the podcast index. loadCollection already
  // sorts alphabetically by filename, and the ep-NN zero-padded slugs make that
  // the same as ascending episode order, so no reversal is needed here.
  const episodes = loadCollection('podcast').map((ep) => ({
    episodeNumber: ep.episodeNumber,
    releaseDate: ep.releaseDate,
    duration: ep.duration,
    status: ep.status,
    guestStatus: ep.guestStatus,
    heroTitle: ep.heroTitle,
    heroSub: ep.heroSub,
    href: `podcast/${ep.slug}.html`,
  }));

  for (const page of PAGES) {
    const data = resolveIcons(decorateRunsDeep(readJson(path.join(CONTENT, 'pages', `${page.content}.json`))));
    const scope = Object.assign({}, data, baseScope(site, data, page.out, page.navKey, page.ogType));
    if (page.template === 'podcast') scope.episodes = episodes;
    const html = render(loadTemplate(page.template), scope, partials);
    fs.writeFileSync(path.join(ROOT, page.out), html);
    written.push(page.out);
  }

  for (const collection of COLLECTIONS) {
    for (const item of loadCollection(collection.key)) {
      // Collections may nest under a subdirectory (e.g. podcast/ep-01.html).
      // outFile keeps the subdir so the canonical URL and sitemap stay correct.
      const outFile = collection.subdir ? `${collection.subdir}/${item.slug}.html` : `${item.slug}.html`;
      const scope = Object.assign({}, item, baseScope(site, item, outFile, collection.navKey, collection.ogType), {
        blocks: decorateBlocks(item.blocks),
      });
      const html = render(loadTemplate(collection.template), scope, partials);
      const destPath = path.join(ROOT, outFile);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, html);
      written.push(outFile);
    }
  }

  process.stdout.write(`built ${written.length} pages: ${written.join(', ')}\n`);
}

main();
