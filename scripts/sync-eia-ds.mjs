#!/usr/bin/env node
/**
 * Vendor do Design System Empreende IA V2 (repositório privado
 * henriquegabriel-ia/empreende-ia-ds-v2 — não há pacote npm).
 *
 * Os arquivos listados em VENDORED são copiados VERBATIM do checkout do DS e
 * registrados em components/eia/.ds-manifest.json (commit do DS + sha256 de
 * cada arquivo). Adaptações do Dispara NUNCA vão nesses arquivos: ficam em
 * components/app/* e styles/dispara-eia.css. Lacuna genérica do DS → PR no
 * repositório do DS e novo sync.
 *
 * Uso:
 *   node scripts/sync-eia-ds.mjs --sync    # copia do checkout do DS e regrava o manifest
 *   node scripts/sync-eia-ds.mjs --check   # (CI) falha se algum arquivo copiado foi editado ou sumiu
 *   node scripts/sync-eia-ds.mjs --diff    # lista o que mudou no checkout do DS desde o último sync
 *
 * Checkout do DS: EIA_DS_PATH ou, por padrão, a pasta irmã
 * "../Design System - Empreende IA v2 [out26]".
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const MANIFEST_PATH = join(ROOT, 'components', 'eia', '.ds-manifest.json')
const DS_PATH = resolve(process.env.EIA_DS_PATH ?? join(ROOT, '..', 'Design System - Empreende IA v2 [out26]'))

/**
 * O que entra no Dispara. Fora de propósito: patterns e pattern-* (demos pesadas
 * do catálogo), CSS do laboratório (app/globals.css do DS), eia-showcase.css,
 * lib/utils e hooks/use-mobile (os do Dispara são equivalentes).
 */
const VENDORED = [
  { dir: 'components/ui', match: (name) => name.endsWith('.tsx') },
  {
    dir: 'components/eia',
    match: (name) =>
      [
        'index.tsx',
        'extended.tsx',
        'composites.tsx',
        'blocks.tsx',
        'theme.tsx',
        'tokens.ts',
        'eia.css',
        'extended.css',
        'composites.css',
        'blocks.css',
      ].includes(name),
  },
  { dir: 'styles', match: (name) => ['eia-tokens.css', 'eia-light.css'].includes(name) },
  { dir: 'public/fonts', match: (name) => ['Manrope-Variable.ttf', 'Manrope-OFL.txt'].includes(name) },
  { dir: 'public/brand', match: (name) => ['eia-light.svg', 'eia-dark.svg', 'eia-mono.svg'].includes(name) },
  { dir: 'public/materials', match: (name) => name === 'empreende-glass-hero.jpg' },
]

const TEXT_EXTENSIONS = ['.ts', '.tsx', '.css', '.svg', '.txt', '.json']

/** sha256 estável entre Windows (CRLF no checkout) e Linux (LF): texto é normalizado para LF. */
function hashFile(path) {
  const buf = readFileSync(path)
  const isText = TEXT_EXTENSIONS.some((ext) => path.endsWith(ext))
  const data = isText ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf
  return createHash('sha256').update(data).digest('hex')
}

function listSource() {
  const files = []
  for (const { dir, match } of VENDORED) {
    const abs = join(DS_PATH, dir)
    if (!existsSync(abs)) throw new Error(`Pasta do DS não encontrada: ${abs}`)
    for (const name of readdirSync(abs).sort()) if (match(name)) files.push(`${dir}/${name}`)
  }
  return files
}

function dsCommit() {
  try {
    const commit = execFileSync('git', ['-C', DS_PATH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['-C', DS_PATH, 'status', '--porcelain', '--', ...VENDORED.map((v) => v.dir)], {
      encoding: 'utf8',
    }).trim()
    return { commit, dirty: dirty.length > 0 }
  } catch {
    return { commit: 'desconhecido', dirty: true }
  }
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

function sync() {
  const files = listSource()
  const { commit, dirty } = dsCommit()
  if (dirty) console.warn('⚠ O checkout do DS tem mudanças não commitadas nas pastas copiadas.')
  const previous = readManifest()
  const manifest = {
    source: 'github.com/henriquegabriel-ia/empreende-ia-ds-v2',
    commit,
    dirty,
    note: 'Arquivos copiados verbatim pelo scripts/sync-eia-ds.mjs. Não edite: adapte em components/app ou styles/dispara-eia.css.',
    files: {},
  }
  for (const rel of files) {
    const dest = join(ROOT, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(DS_PATH, rel), dest)
    manifest.files[rel] = hashFile(dest)
  }
  const removed = Object.keys(previous?.files ?? {}).filter((rel) => !(rel in manifest.files))
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`✓ ${files.length} arquivos copiados do DS (${commit.slice(0, 7)}).`)
  if (removed.length) console.log(`Saíram do DS (apague no Dispara se não forem mais usados):\n  ${removed.join('\n  ')}`)
}

function check() {
  const manifest = readManifest()
  if (!manifest) {
    console.error('✗ components/eia/.ds-manifest.json não existe. Rode: node scripts/sync-eia-ds.mjs --sync')
    process.exit(1)
  }
  const problems = []
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) problems.push(`sumiu: ${rel}`)
    else if (hashFile(abs) !== expected) problems.push(`editado localmente: ${rel}`)
  }
  if (problems.length) {
    console.error(
      `✗ ${problems.length} arquivo(s) do DS divergem do manifest:\n  ${problems.join('\n  ')}\n` +
        'Arquivos do DS são verbatim: adapte em components/app ou styles/dispara-eia.css, ou corrija no repositório do DS e rode --sync.',
    )
    process.exit(1)
  }
  console.log(`✓ ${Object.keys(manifest.files).length} arquivos do DS intactos (commit ${manifest.commit.slice(0, 7)}).`)
}

function diff() {
  const manifest = readManifest()
  const files = listSource()
  const changed = []
  for (const rel of files) {
    const now = hashFile(join(DS_PATH, rel))
    if (manifest?.files?.[rel] !== now) changed.push(manifest?.files?.[rel] ? `alterado: ${rel}` : `novo: ${rel}`)
  }
  for (const rel of Object.keys(manifest?.files ?? {})) if (!files.includes(rel)) changed.push(`removido no DS: ${rel}`)
  const { commit } = dsCommit()
  console.log(`DS em ${commit.slice(0, 7)} · último sync em ${manifest?.commit?.slice(0, 7) ?? '—'}`)
  console.log(changed.length ? changed.join('\n') : 'Sem diferenças.')
}

const mode = process.argv[2]
if (mode === '--sync') sync()
else if (mode === '--check') check()
else if (mode === '--diff') diff()
else {
  console.error('Uso: node scripts/sync-eia-ds.mjs --sync | --check | --diff')
  process.exit(2)
}
