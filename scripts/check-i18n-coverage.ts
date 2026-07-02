#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — verify literal i18n callsites exist in en.json.
 *
 * This complements locale parity: parity proves locale files agree with each
 * other, while coverage proves literal `t(...)` / `i18n.t(...)` / `<Trans
 * i18nKey=...>` references resolve against the English source of truth.
 * Dynamic keys are intentionally skipped.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_PATH = join(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')
const SEARCH_ROOTS = ['apps', 'packages'].map((dir) => join(ROOT, dir))

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'dist-release',
  'node_modules',
  'release',
])
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']

const en = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Record<string, string>
const enKeys = new Set(Object.keys(en))

interface Reference {
  key: string
  file: string
  line: number
  kind: string
}

function isKnownKey(key: string): boolean {
  if (enKeys.has(key)) return true
  return PLURAL_SUFFIXES.some((suffix) => enKeys.has(`${key}_${suffix}`))
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

function unescapeLiteral(raw: string): string {
  return raw
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\')
}

function* walk(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.storybook') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(path)
      continue
    }
    if (!entry.isFile()) continue
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
    yield path
  }
}

function collectReferences(file: string): Reference[] {
  const text = readFileSync(file, 'utf-8')
  const refs: Reference[] = []
  const rel = relative(ROOT, file)

  // Matches literal t('key'), t("key"), t(`key`) and i18n.t(...). Template
  // literals containing interpolation are skipped because the key is dynamic.
  const tCallPattern = /\b(?:i18n\.)?t\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  for (const match of text.matchAll(tCallPattern)) {
    const quote = match[1]
    const raw = match[2] ?? ''
    if (quote === '`' && raw.includes('${')) continue
    refs.push({
      key: unescapeLiteral(raw),
      file: rel,
      line: lineNumberAt(text, match.index ?? 0),
      kind: 't',
    })
  }

  // Matches <Trans i18nKey="key"> and <Trans i18nKey={'key'}> literal forms.
  const transPattern = /\bi18nKey\s*=\s*(?:\{\s*)?(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  for (const match of text.matchAll(transPattern)) {
    const quote = match[1]
    const raw = match[2] ?? ''
    if (quote === '`' && raw.includes('${')) continue
    refs.push({
      key: unescapeLiteral(raw),
      file: rel,
      line: lineNumberAt(text, match.index ?? 0),
      kind: 'Trans.i18nKey',
    })
  }

  return refs
}

const missing: Reference[] = []
let scannedFiles = 0
let referenceCount = 0

for (const root of SEARCH_ROOTS) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue
  for (const file of walk(root)) {
    scannedFiles++
    for (const ref of collectReferences(file)) {
      referenceCount++
      if (!isKnownKey(ref.key)) missing.push(ref)
    }
  }
}

if (missing.length > 0) {
  console.error('i18n coverage check failed: missing keys in en.json')
  for (const ref of missing.slice(0, 80)) {
    console.error(`  ${ref.file}:${ref.line} ${ref.kind}('${ref.key}')`)
  }
  if (missing.length > 80) {
    console.error(`  ...and ${missing.length - 80} more`)
  }
  process.exit(1)
}

console.log(`i18n coverage OK (${referenceCount} literal refs across ${scannedFiles} files)`)
