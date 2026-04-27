#!/usr/bin/env tsx
/**
 * Build Squarespace-paste-ready HTML snippets from website/WEBSITE_CONTENT.md
 *
 * Reality check: Squarespace doesn't have a public write API for page
 * content on standard plans, so true "git push → live website" automation
 * isn't possible without leaving Squarespace. This script does the next-
 * best thing: it splits the content markdown by major section, converts
 * each to clean HTML that copy-pastes into a Squarespace Code Block, and
 * tells you which sections changed since the last run so you know what
 * actually needs re-pasting.
 *
 * Usage:
 *   npx tsx scripts/build-squarespace-snippets.ts
 *
 * Output:
 *   website/squarespace-snippets/<section-slug>.html
 *   website/squarespace-snippets/.last-build.json (hashes for change detection)
 *
 * Workflow:
 *   1. Edit website/WEBSITE_CONTENT.md
 *   2. Run this script
 *   3. It tells you which sections changed
 *   4. Open each changed snippet, copy-all, paste into the matching
 *      Squarespace Code Block
 *
 * Section split rule: "## " headings = top-level marketing sections.
 * "### " sub-sections (e.g. "### Feature Category 7") roll up under
 * their parent ## section.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'website', 'WEBSITE_CONTENT.md');
const OUT_DIR = join(ROOT, 'website', 'squarespace-snippets');
const HASHES_FILE = join(OUT_DIR, '.last-build.json');

// ANSI colors (skip if not a TTY)
const COLOR = process.stdout.isTTY;
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c('32', s);
const yellow = (s: string) => c('33', s);
const dim = (s: string) => c('2', s);
const bold = (s: string) => c('1', s);

interface Section {
  title: string;
  slug: string;
  markdown: string;
  html: string;
  hash: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function hashContent(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

/**
 * Minimal markdown → HTML converter for the patterns this content
 * file actually uses. Deliberately not pulling in a full library —
 * this gives us full control over the output and avoids a new dep.
 *
 * Supports: H1-H4, bold, italic, inline code, links, bullet lists,
 * GFM-style tables, hr (---), paragraphs, line breaks.
 */
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  const inline = (text: string): string => {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/&/g, '&amp;')
      .replace(/&amp;(amp|lt|gt|quot|#\d+|[a-z]+);/g, '&$1;') // un-escape what we just over-escaped
      .replace(/<(?!\/?(strong|em|code|a|br)\b)/g, '&lt;');
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Headings
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // Tables (GFM): | cell | cell | followed by | --- | --- |
    if (trimmed.startsWith('|') && lines[i + 1]?.trim().match(/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/)) {
      const headerCells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        rows.push(row);
        i++;
      }
      out.push('<table style="width:100%;border-collapse:collapse;">');
      out.push('  <thead><tr>');
      for (const h of headerCells) {
        out.push(`    <th style="text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;">${inline(h)}</th>`);
      }
      out.push('  </tr></thead>');
      out.push('  <tbody>');
      for (const r of rows) {
        out.push('    <tr>');
        for (const cell of r) {
          out.push(`      <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${inline(cell)}</td>`);
        }
        out.push('    </tr>');
      }
      out.push('  </tbody></table>');
      continue;
    }

    // Bullet lists
    if (/^[-*]\s/.test(trimmed)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        out.push(`  <li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    // Numbered lists
    if (/^\d+\.\s/.test(trimmed)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        out.push(`  <li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }

    // Blank line
    if (trimmed === '') {
      i++;
      continue;
    }

    // Paragraph — collect contiguous non-empty non-special lines
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().match(/^(#{1,4}\s|---+$|\||[-*]\s|\d+\.\s)/)
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }
  }

  return out.join('\n');
}

/**
 * Split content by `## ` H2 headings — those are the top-level
 * marketing sections (Hero, Pricing, Feature Categories, FAQs, etc).
 * Everything before the first H2 becomes a "preface" section.
 */
function splitSections(md: string): Section[] {
  const sections: Section[] = [];
  const parts = md.split(/^(?=## )/m);
  const slugCounts = new Map<string, number>();

  for (const part of parts) {
    if (!part.trim()) continue;
    const titleMatch = part.match(/^##\s+(.*)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'preface';
    const baseSlug = slugify(title);

    // Disambiguate duplicate slugs by appending a counter (e.g., when
    // the same H2 title appears multiple times in the source file).
    const count = (slugCounts.get(baseSlug) ?? 0) + 1;
    slugCounts.set(baseSlug, count);
    const slug = count === 1 ? baseSlug : `${baseSlug}-${count}`;

    const html = mdToHtml(part);
    const hash = hashContent(part);
    sections.push({ title, slug, markdown: part, html, hash });
  }

  return sections;
}

function loadHashes(): Record<string, string> {
  if (!existsSync(HASHES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HASHES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`✗ Source file not found: ${SOURCE}`);
    process.exit(1);
  }

  const md = readFileSync(SOURCE, 'utf-8');
  const sections = splitSections(md);
  const previousHashes = loadHashes();
  const newHashes: Record<string, string> = {};

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(bold(`Building ${sections.length} Squarespace snippets from website/WEBSITE_CONTENT.md\n`));

  let changed = 0;
  let unchanged = 0;
  let added = 0;

  for (const section of sections) {
    const filename = `${section.slug}.html`;
    const path = join(OUT_DIR, filename);
    const previous = previousHashes[section.slug];

    const wrapped = [
      `<!-- ${section.title} — auto-generated from website/WEBSITE_CONTENT.md -->`,
      `<!-- Hash: ${section.hash} | DO NOT EDIT THIS FILE — edit the markdown source -->`,
      '',
      section.html,
    ].join('\n');

    writeFileSync(path, wrapped);
    newHashes[section.slug] = section.hash;

    if (!previous) {
      console.log(`  ${green('+')} ${section.title} ${dim(`→ ${filename} (new)`)}`);
      added++;
    } else if (previous !== section.hash) {
      console.log(`  ${yellow('●')} ${section.title} ${dim(`→ ${filename} (changed)`)}`);
      changed++;
    } else {
      unchanged++;
    }
  }

  if (unchanged > 0) {
    console.log(dim(`  ${unchanged} section${unchanged === 1 ? '' : 's'} unchanged`));
  }

  writeFileSync(HASHES_FILE, JSON.stringify(newHashes, null, 2));

  console.log();
  if (added + changed === 0) {
    console.log(green('✓ Nothing changed since last build. No Squarespace updates needed.'));
  } else {
    console.log(bold(`Action items for Squarespace:`));
    console.log();
    if (added > 0) {
      console.log(`  ${green(String(added))} new section${added === 1 ? '' : 's'} — paste into a NEW Code Block in Squarespace`);
    }
    if (changed > 0) {
      console.log(`  ${yellow(String(changed))} updated section${changed === 1 ? '' : 's'} — replace the matching existing Code Block content`);
    }
    console.log();
    console.log(`  Snippets are in: ${dim(OUT_DIR)}`);
    console.log(`  Open each, ${bold('Cmd-A Cmd-C')}, paste into the matching Squarespace block.`);
  }
}

main();
