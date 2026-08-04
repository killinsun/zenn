#!/usr/bin/env node
/**
 * Zenn 記事の機械検査。
 *
 * このスクリプトが機械検査ロジックの唯一の正（SSoT）。
 * .githooks/pre-push と /publish-check スキルの双方から呼ばれる。
 *
 * 使い方:
 *   node scripts/validate-articles.mjs                 # 変更された記事のみ（origin/main との差分）
 *   node scripts/validate-articles.mjs --all           # articles/ 配下すべて
 *   node scripts/validate-articles.mjs <file>...       # ファイル指定
 *   node scripts/validate-articles.mjs --json          # JSON 出力（スキルから使う）
 *   node scripts/validate-articles.mjs --range a..b    # 指定リビジョン範囲の差分
 *
 * 終了コード: error が 1 件でもあれば 1、なければ 0（warn では落とさない）
 *
 * 検査の厳しさは published の値で変わる:
 *   published: false → 秘匿値・画像不在・frontmatter 構文のみ error
 *                      （下書きでも public リポジトリなので秘匿値は必ず止める）
 *   published: true  → 全項目 error
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES_DIR = join(ROOT, 'articles');

// ---------------------------------------------------------------- 秘匿値パターン

/** 高確度の秘匿値。published の値に関わらず常に error にする。 */
const SECRET_PATTERNS = [
  { re: /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}/g, label: 'OpenAI / Anthropic API キー' },
  { re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g, label: 'GitHub トークン' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, label: 'GitHub Fine-grained トークン' },
  { re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS アクセスキー ID' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'Slack トークン' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'Google API キー' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: '秘密鍵' },
  { re: /\bop:\/\/[^\s"'`)]+/g, label: '1Password シークレット参照' },
  { re: /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis):\/\/[^\s:/@"'`]+:[^\s:/@"'`]+@/g, label: '認証情報付き DB 接続文字列' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g, label: 'GitLab トークン' },
  { re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, label: 'SendGrid API キー' },
  { re: /\b(sk|pk)_(live|test)_[A-Za-z0-9]{20,}/g, label: 'Stripe API キー' },
];

/** 内部情報の疑い。published: true でのみ error、false では warn。 */
const INTERNAL_PATTERNS = [
  { re: /\barn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/g, label: 'AWS ARN（アカウント ID を含む）' },
  { re: /\bhttps?:\/\/[^\s"'`)]*\.internal\b[^\s"'`)]*/g, label: '内部ドメインの URL' },
  { re: /\bhttps?:\/\/(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.[\d.]+/g, label: 'プライベート IP の URL' },
  { re: /\bhttps?:\/\/[^\s"'`)]*\.atlassian\.net\/[^\s"'`)]+/g, label: 'Jira / Confluence の URL' },
  { re: /\bhttps?:\/\/[^\s"'`)]*\.slack\.com\/archives\/[^\s"'`)]+/g, label: 'Slack のパーマリンク' },
  { re: /\bhttps?:\/\/(www\.)?notion\.so\/[^\s"'`)]+/g, label: 'Notion の URL' },
  { re: /\bhttps?:\/\/[^\s"'`)]*\.(datadoghq|sentry)\.(com|io)\/[^\s"'`)]+/g, label: '監視ダッシュボードの URL' },
];

// ---------------------------------------------------------------- frontmatter

const SLUG_RE = /^[a-z0-9_-]{12,50}$/;
const PUBLISHED_AT_RE = /^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2})?$/;
const TOPIC_INVALID_RE = /[\s!-/:-@[-`{-~]/; // 記号とスペース

/** `"値" # コメント` / `値 # コメント` からスカラー値を取り出す。 */
function scalar(v) {
  const quoted = v.match(/^(["'])([\s\S]*?)\1\s*(?:#.*)?$/);
  if (quoted) return { value: quoted[2], quoted: true };
  return { value: v.replace(/\s+#.*$/, '').trim(), quoted: false };
}

/**
 * frontmatter の最小パーサ。
 * Zenn の frontmatter で実際に使われる範囲だけを扱う:
 *   key: value / key: "value" / key: [a, b] / key:\n  - a\n  - b / 行末コメント
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { ok: false, data: {}, body: raw, rawKeys: [] };

  const data = {};
  const rawKeys = [];
  const fmLines = m[1].split(/\r?\n/);

  for (let i = 0; i < fmLines.length; i++) {
    const kv = fmLines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    rawKeys.push(key);

    // インライン配列 [a, b]
    const inline = rest.trim().match(/^\[([\s\S]*)\]\s*(?:#.*)?$/);
    if (inline) {
      const inner = inline[1].trim();
      const arr = inner === '' ? [] : inner.split(',').map((s) => scalar(s.trim()));
      arr.__isArray = true;
      data[key] = arr;
      continue;
    }

    // ブロック配列（key: の直後に "  - x" が続く）
    if (rest.trim() === '' || rest.trim().startsWith('#')) {
      const arr = [];
      let j = i + 1;
      while (j < fmLines.length && /^\s*-\s+/.test(fmLines[j])) {
        arr.push(scalar(fmLines[j].replace(/^\s*-\s+/, '').trim()));
        j++;
      }
      if (arr.length) {
        arr.__isArray = true;
        data[key] = arr;
        i = j - 1;
        continue;
      }
    }

    data[key] = scalar(rest.trim());
  }

  return { ok: true, data, body: raw.slice(m[0].length), rawKeys, fmLines: fmLines.length + 2 };
}

const graphemes = (s) => {
  const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  return [...seg.segment(s)].map((x) => x.segment);
};

// ---------------------------------------------------------------- 本文の走査

/** コードブロック（``` と ~~~）の内側にある行番号の集合を返す。 */
function codeBlockLines(lines) {
  const inside = new Set();
  let fence = null;
  lines.forEach((line, i) => {
    const open = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      inside.add(i);
      if (open && open[1].startsWith(fence[0]) && open[1].length >= fence.length) fence = null;
    } else if (open) {
      fence = open[1];
      inside.add(i);
    }
  });
  return inside;
}

// ---------------------------------------------------------------- 検査本体

function validate(file) {
  const rel = relative(ROOT, file) || basename(file);
  const issues = [];
  const add = (level, line, rule, message) => issues.push({ level, line, rule, message });

  const raw = readFileSync(file, 'utf8');
  const { ok, data, body, rawKeys, fmLines = 0 } = parseFrontmatter(raw);
  const lines = raw.split(/\r?\n/);
  const inCode = codeBlockLines(lines);

  if (!ok) {
    add('error', 1, 'frontmatter-missing', 'frontmatter (--- で囲まれたブロック) がありません');
    return { file: rel, published: null, issues };
  }

  const val = (k) => (data[k] && !data[k].__isArray ? data[k].value : undefined);
  const published = val('published') === 'true' ? true : val('published') === 'false' ? false : null;

  // 自前の追加チェック。published: true のときだけ error に昇格する。
  // Zenn 側で isCritical: false のルールは published に関わらず warn のままにする
  // （Zenn が受け付ける記事を push できなくしないため）。
  const strict = (line, rule, message) =>
    add(published === true ? 'error' : 'warn', line, rule, message);

  const fmLine = (key) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    return i >= 0 ? i + 1 : 1;
  };

  // -------- frontmatter

  const title = val('title');
  if (title === undefined || title === '') {
    add('error', 1, 'missing-title', 'title を文字列で指定してください');
  } else if (graphemes(title).length > 70) {
    add('error', fmLine('title'), 'title-length', `title は70字以内にしてください（現在 ${graphemes(title).length}字）`);
  }

  const emoji = val('emoji');
  if (emoji === undefined || emoji === '') {
    add('warn', 1, 'missing-emoji', 'アイキャッチとなる emoji を指定してください');
  } else if (graphemes(emoji).length !== 1) {
    add('error', fmLine('emoji'), 'emoji-format', `emoji は1文字だけ指定してください（現在 ${graphemes(emoji).length}文字）`);
  }

  const type = val('type');
  if (type !== 'tech' && type !== 'idea') {
    add('error', fmLine('type'), 'article-type', `type は tech か idea を指定してください（現在 ${JSON.stringify(type)}）`);
  }

  const topics = data.topics;
  if (!topics || !topics.__isArray) {
    add('warn', fmLine('topics'), 'missing-topics', 'topics を配列で指定してください 例) ["react", "typescript"]');
  } else if (topics.length === 0) {
    add('warn', fmLine('topics'), 'missing-topics', 'topics が空です。1つ以上指定してください');
  } else {
    if (topics.length > 5) {
      add('error', fmLine('topics'), 'too-many-topics', `topics は最大5つまでです（現在 ${topics.length}個）`);
    }
    for (const t of topics) {
      if (TOPIC_INVALID_RE.test(t.value)) {
        add('warn', fmLine('topics'), 'invalid-topic-letters', `topics "${t.value}" に記号かスペースが含まれています（C++ は cpp、C# は csharp）`);
      }
    }
  }

  if (published === null) {
    const rawPublished = val('published');
    add('error', fmLine('published'), 'published-status',
      rawPublished === undefined
        ? 'published を true か false で指定してください'
        : `published は真偽値です。クォートで囲まないでください（現在 ${JSON.stringify(rawPublished)}）`);
  } else if (data.published?.quoted) {
    add('error', fmLine('published'), 'published-status', 'published をクォートで囲まないでください');
  }

  const publishedAt = val('published_at');
  if (publishedAt !== undefined && publishedAt !== '') {
    if (!PUBLISHED_AT_RE.test(publishedAt)) {
      add('error', fmLine('published_at'), 'published-at-parse', 'published_at は YYYY-MM-DD か YYYY-MM-DD hh:mm で指定してください');
    } else if (new Date(publishedAt.replace(' ', 'T')) > new Date() && published !== true) {
      add('error', fmLine('published_at'), 'published-at-schedule', 'published_at に未来日時を指定する場合は published: true が必要です');
    }
  }

  if (rawKeys.includes('tags')) {
    add('warn', fmLine('tags'), 'use-tags', 'tags ではなく topics を使ってください');
  }

  const slug = basename(file, '.md');
  if (!SLUG_RE.test(slug)) {
    add('error', 1, 'invalid-slug', `ファイル名は a-z0-9 とハイフン・アンダースコアの12〜50字にしてください（現在 "${slug}"）`);
  }

  // -------- 秘匿値（published に関わらず常に error）

  lines.forEach((line, i) => {
    for (const { re, label } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      const hit = re.exec(line);
      if (hit) {
        const masked = hit[0].slice(0, 8) + '…';
        add('error', i + 1, 'secret', `${label} らしき文字列が含まれています: ${masked}`);
      }
    }
    for (const { re, label } of INTERNAL_PATTERNS) {
      re.lastIndex = 0;
      const hit = re.exec(line);
      if (hit) {
        strict(i + 1, 'internal-reference', `${label} が含まれています: ${hit[0].slice(0, 60)}`);
      }
    }
  });

  // -------- 画像

  const imgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  lines.forEach((line, i) => {
    if (inCode.has(i)) return;
    imgRe.lastIndex = 0;
    let m;
    while ((m = imgRe.exec(line))) {
      const [, alt, path] = m;
      if (path.startsWith('http://') || path.startsWith('https://')) continue;

      if (!path.startsWith('/images/')) {
        add('error', i + 1, 'image-path', `画像は /images/ から始まる絶対パスで参照してください（現在 "${path}"）`);
        continue;
      }
      if (!existsSync(join(ROOT, path.slice(1)))) {
        add('error', i + 1, 'image-missing', `参照している画像が存在しません: ${path}`);
      }
      if (!alt.trim() || /^(alt\s*text|image|img|screenshot|スクショ|画像)$/i.test(alt.trim())) {
        strict(i + 1, 'image-alt', `alt テキストがプレースホルダーのままです: "${alt}"`);
      }
    }
  });

  // -------- 見出し

  let prevLevel = 0;
  lines.forEach((line, i) => {
    if (inCode.has(i) || i < fmLines) return;
    const h = line.match(/^(#{1,6})\s+\S/);
    if (!h) return;
    const level = h[1].length;
    if (level === 1) {
      strict(i + 1, 'h1-in-body', 'H1 (#) は記事タイトルとして使われます。本文の見出しは ## から始めてください');
    }
    if (prevLevel && level > prevLevel + 1) {
      strict(i + 1, 'heading-jump', `見出しレベルが飛んでいます（h${prevLevel} → h${level}）`);
    }
    prevLevel = level;
  });

  // -------- 書きかけ

  lines.forEach((line, i) => {
    if (inCode.has(i) || i < fmLines) return;
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
      strict(i + 1, 'wip-marker', `書きかけのマーカーが残っています: ${line.trim().slice(0, 50)}`);
    }
    if (/<!--\s*(ここに書くこと|コード|画像)[:：]/.test(line)) {
      strict(i + 1, 'wip-placeholder', `/article が置いたプレースホルダーが残っています: ${line.trim().slice(0, 50)}`);
    }
  });

  // -------- リンクのプレースホルダー

  lines.forEach((line, i) => {
    if (inCode.has(i)) return;
    const m = line.match(/\]\((https?:\/\/example\.com[^)]*|#|<URL>)\)/);
    if (m) strict(i + 1, 'placeholder-link', `未置換のリンクがあります: ${m[1]}`);
  });

  // -------- 本文の存在

  if (body.trim().length < 100 && published === true) {
    add('error', fmLines + 1, 'empty-body', '本文がほとんどありません');
  }

  return { file: rel, published, issues };
}

// ---------------------------------------------------------------- 対象ファイルの決定

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function changedArticles(range) {
  const out = git(['diff', '--name-only', '--diff-filter=ACMR', range, '--', 'articles/']);
  return out ? out.split('\n').filter(Boolean).map((p) => join(ROOT, p)) : [];
}

function resolveTargets(argv) {
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length) return files.map((f) => resolve(f));

  if (argv.includes('--all')) {
    return readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md')).map((f) => join(ARTICLES_DIR, f));
  }

  const rangeArg = argv.find((a) => a.startsWith('--range='));
  if (rangeArg) return changedArticles(rangeArg.slice('--range='.length));

  // 既定: origin/main との差分。取れなければ未コミット分。
  const base = git(['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main...HEAD' : 'HEAD~1...HEAD';
  const changed = changedArticles(base);
  if (changed.length) return changed;

  const dirty = git(['status', '--porcelain', '--', 'articles/'])
    .split('\n').filter(Boolean).map((l) => join(ROOT, l.slice(3).trim()));
  return dirty;
}

// ---------------------------------------------------------------- 出力

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

function report(results) {
  let errors = 0;
  let warns = 0;

  for (const r of results) {
    const e = r.issues.filter((i) => i.level === 'error');
    const w = r.issues.filter((i) => i.level === 'warn');
    errors += e.length;
    warns += w.length;

    const state = r.published === true ? 'published' : r.published === false ? 'draft' : '?';
    if (!r.issues.length) {
      console.log(`  ${C.green}✓${C.off} ${r.file} ${C.dim}(${state})${C.off}`);
      continue;
    }
    console.log(`  ${r.file} ${C.dim}(${state})${C.off}`);
    for (const i of [...e, ...w].sort((a, b) => a.line - b.line)) {
      const mark = i.level === 'error' ? `${C.red}✗${C.off}` : `${C.yellow}!${C.off}`;
      console.log(`    ${mark} L${i.line} ${C.dim}[${i.rule}]${C.off} ${i.message}`);
    }
  }
  return { errors, warns };
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const targets = resolveTargets(argv).filter((f) => f.endsWith('.md') && existsSync(f));

if (!targets.length) {
  if (argv.includes('--json')) console.log(JSON.stringify({ results: [], errors: 0, warns: 0 }));
  else console.log(`${C.dim}検査対象の記事はありません。${C.off}`);
  process.exit(0);
}

const results = targets.map(validate);

// pre-push が textlint の厳しさを出し分けるために使う
if (argv.includes('--list-published')) {
  console.log(results.filter((r) => r.published === true).map((r) => r.file).join('\n'));
  process.exit(0);
}

if (argv.includes('--json')) {
  const errors = results.reduce((n, r) => n + r.issues.filter((i) => i.level === 'error').length, 0);
  const warns = results.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warn').length, 0);
  console.log(JSON.stringify({ results, errors, warns }, null, 2));
  process.exit(errors > 0 ? 1 : 0);
}

console.log(`${C.bold}▶ 記事の機械検査${C.off} ${C.dim}(${targets.length}件)${C.off}`);
const { errors, warns } = report(results);
console.log('');

if (errors > 0) {
  console.log(`${C.red}✗ error ${errors}件${C.off}${warns ? ` / ${C.yellow}warn ${warns}件${C.off}` : ''}`);
  process.exit(1);
}
if (warns > 0) console.log(`${C.yellow}! warn ${warns}件${C.off} ${C.dim}（push は通ります）${C.off}`);
else console.log(`${C.green}✓ 問題なし${C.off}`);
process.exit(0);
