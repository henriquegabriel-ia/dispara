#!/usr/bin/env node
/**
 * Catraca da migração para o Design System Empreende IA V2.
 *
 * Conta o que ainda pertence ao visual antigo (primitivas shadcn/Radix,
 * sonner, next-themes, variante dark:, variáveis --ds-*, hex e paletas
 * Tailwind fixas, controles HTML crus) e compara com a linha de base em
 * scripts/ds-migration-baseline.json. Nenhuma métrica pode subir: cada PR da
 * migração baixa os números e atualiza a linha de base.
 *
 * Uso:
 *   node scripts/ds-migration-report.mjs            # relatório (totais + arquivos com mais ocorrências)
 *   node scripts/ds-migration-report.mjs --check    # falha (exit 1) se alguma métrica passou da linha de base
 *   node scripts/ds-migration-report.mjs --update   # grava os números atuais como nova linha de base
 *   node scripts/ds-migration-report.mjs --area components/features/inbox   # só uma pasta
 *
 * Arquivos copiados do DS (listados em components/eia/.ds-manifest.json) ficam
 * fora da contagem: o código do DS é a referência, não dívida.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'ds-migration-baseline.json')
const DS_MANIFEST_PATH = join(ROOT, 'components', 'eia', '.ds-manifest.json')
const SCAN_DIRS = ['app', 'components', 'hooks', 'lib', 'services']
const EXTENSIONS = new Set(['.ts', '.tsx'])

/** Conteúdo que representa a interface do WhatsApp (cores do próprio WhatsApp): hex permitido. */
const HEX_ALLOWLIST = new Set([
  'components/app/WhatsAppPhonePreview.tsx',
  'components/app/TemplatePreviewCard.tsx',
  'components/app/MetaFlowPreview.tsx',
  'components/app/whatsapp-text.tsx',
  'components/features/templates/TemplatePreviewRenderer.tsx',
])

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary'

/** Cada métrica: regex global aplicada ao conteúdo; `files` restringe a extensão. */
const METRICS = {
  legacyUiImports: {
    label: 'imports de primitivas shadcn/Radix (legacy-ui)',
    // Antes do vendor do DS, components/ui ainda é o shadcn/Radix antigo.
    pattern: () =>
      existsSync(DS_MANIFEST_PATH)
        ? /['"]@\/components\/legacy-ui\//g
        : /['"]@\/components\/(?:legacy-)?ui\//g,
  },
  radixImports: { label: "imports de '@radix-ui/*'", pattern: () => /from\s+['"]@radix-ui\//g },
  sonnerImports: { label: "imports de 'sonner'", pattern: () => /from\s+['"]sonner['"]/g },
  nextThemesImports: { label: "imports de 'next-themes'", pattern: () => /from\s+['"]next-themes['"]/g },
  darkVariant: { label: 'variante dark: (tema antigo por classe .dark)', pattern: () => /(?<![\w-])dark:/g },
  legacyDarkVariant: { label: 'variante legacy-dark: (ponte temporária)', pattern: () => /(?<![\w-])legacy-dark:/g },
  dsVariables: { label: 'referências a --ds-* (tokens antigos)', pattern: () => /--ds-[a-z0-9-]+/g },
  paletteClasses: {
    label: 'utilitários de paleta Tailwind fixa (slate-500, primary-400…)',
    pattern: () =>
      new RegExp(
        `(?<![\\w-])(?:[a-z]+:)*(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|outline|shadow|divide|placeholder|accent|caret|decoration)-(?:${PALETTE})-\\d{2,3}\\b`,
        'g',
      ),
  },
  hexColors: {
    label: 'cores hex em .tsx (fora dos previews de WhatsApp)',
    files: ['.tsx'],
    pattern: () => /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
    skip: (rel) => HEX_ALLOWLIST.has(rel),
  },
  rawControls: {
    label: 'controles HTML crus (<button>, <input>, <select>, <textarea>, <table>)',
    files: ['.tsx'],
    pattern: () => /<(?:button|input|select|textarea|table)\b/g,
  },
}

function parseArgs(argv) {
  const args = { check: false, update: false, area: null, top: 15 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') args.check = true
    else if (a === '--update') args.update = true
    else if (a === '--area') args.area = argv[++i]
    else if (a === '--top') args.top = Number(argv[++i]) || args.top
  }
  return args
}

function loadVendored() {
  if (!existsSync(DS_MANIFEST_PATH)) return new Set()
  const manifest = JSON.parse(readFileSync(DS_MANIFEST_PATH, 'utf8'))
  return new Set(Object.keys(manifest.files ?? {}))
}

function walk(dir, out) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function collectFiles(area) {
  const vendored = loadVendored()
  const roots = area ? [join(ROOT, area)] : SCAN_DIRS.map((d) => join(ROOT, d))
  const files = []
  for (const r of roots) {
    for (const full of walk(r, [])) {
      const rel = relative(ROOT, full).split(sep).join('/')
      const ext = rel.slice(rel.lastIndexOf('.'))
      if (!EXTENSIONS.has(ext)) continue
      if (/\.test\.tsx?$/.test(rel) || rel.includes('/__tests__/')) continue
      if (vendored.has(rel)) continue
      files.push({ rel, ext, full })
    }
  }
  return files
}

function measure(files) {
  const totals = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]))
  const perFile = Object.fromEntries(Object.keys(METRICS).map((k) => [k, []]))
  for (const { rel, ext, full } of files) {
    const src = readFileSync(full, 'utf8')
    for (const [key, m] of Object.entries(METRICS)) {
      if (m.files && !m.files.includes(ext)) continue
      if (m.skip?.(rel)) continue
      const n = (src.match(m.pattern()) ?? []).length
      if (n > 0) {
        totals[key] += n
        perFile[key].push([rel, n])
      }
    }
  }
  for (const key of Object.keys(perFile)) perFile[key].sort((a, b) => b[1] - a[1])
  return { totals, perFile }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const files = collectFiles(args.area)
  const { totals, perFile } = measure(files)

  if (args.update) {
    if (args.area) {
      console.error('--update não aceita --area (a linha de base é do repositório inteiro).')
      process.exit(2)
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(totals, null, 2) + '\n')
    console.log(`Linha de base gravada em ${relative(ROOT, BASELINE_PATH)}.`)
    return
  }

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null
  const failures = []
  const canLower = []

  console.log(`DS V2 · catraca da migração${args.area ? ` (área: ${args.area})` : ''} · ${files.length} arquivos\n`)
  for (const [key, m] of Object.entries(METRICS)) {
    const now = totals[key]
    const base = baseline?.[key]
    let status = ''
    if (!args.area && typeof base === 'number') {
      if (now > base) {
        status = `  ✗ subiu (linha de base ${base})`
        failures.push(key)
      } else if (now < base) {
        status = `  ↓ ${base - now} a menos (linha de base ${base})`
        canLower.push(key)
      }
    }
    console.log(`${String(now).padStart(6)}  ${m.label}${status}`)
  }

  if (!args.check && args.top > 0) {
    for (const [key, list] of Object.entries(perFile)) {
      if (list.length === 0) continue
      console.log(`\n${METRICS[key].label} — arquivos com mais ocorrências:`)
      for (const [rel, n] of list.slice(0, args.top)) console.log(`${String(n).padStart(6)}  ${rel}`)
    }
  }

  if (args.check) {
    if (!baseline) {
      console.error(`\nSem linha de base (${relative(ROOT, BASELINE_PATH)}). Rode com --update.`)
      process.exit(1)
    }
    if (failures.length > 0) {
      console.error(
        `\n✗ ${failures.length} métrica(s) passaram da linha de base: ${failures.join(', ')}.` +
          '\n  Use componentes Eia*/tokens --eia-* no código novo em vez do visual antigo.',
      )
      process.exit(1)
    }
    if (canLower.length > 0) {
      console.log(`\nA linha de base pode baixar (${canLower.join(', ')}): rode com --update e commite.`)
    }
    console.log('\n✓ Nenhuma métrica subiu.')
  }
}

main()
