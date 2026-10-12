'use client'

import { useEffect } from 'react'
import { EiaButton } from '@/components/eia'
import { BRAND } from '@/lib/branding'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Último recurso: erro no layout raiz. O layout não é renderizado, então
 * esta tela traz <html>/<body> próprios e não pode contar com o CSS global
 * (nem com a Manrope do next/font).
 *
 * Estilos num <style> local, todos dentro de :where() (especificidade zero):
 * - se o CSS do DS ainda estiver na página, os tokens --eia-* e o eia.css
 *   vencem (o EiaButton fica igual ao do app, com hover e foco);
 * - se não estiver, valem os fallbacks, que são os valores do tema escuro de
 *   styles/eia-tokens.css (fundo, superfície, texto, botão primário).
 */
const FALLBACK_CSS = `
:where(.dispara-ge) {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  box-sizing: border-box;
  background: var(--eia-color-bg, rgb(8 10 9));
  color: var(--eia-color-text, rgb(246 247 246));
  font-family: var(--eia-font-body, Manrope, Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
}
:where(.dispara-ge-card) {
  width: 100%;
  max-width: 28rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 24px;
  text-align: center;
  background: var(--eia-color-surface, rgb(17 22 19));
  border: 1px solid var(--eia-border-subtle, rgb(255 255 255 / 0.11));
  border-radius: var(--eia-radius-panel, 23px);
}
:where(.dispara-ge-title) {
  margin: 0;
  font-size: var(--eia-type-lead, 1.125rem);
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: -0.025em;
}
:where(.dispara-ge-text) {
  margin: 0;
  max-width: 36ch;
  color: var(--eia-color-text-muted, rgb(180 189 183));
  font-size: var(--eia-type-control, 0.875rem);
  line-height: 1.65;
}
:where(.dispara-ge-actions) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 12px;
}
:where(.dispara-ge-actions .eia-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 11px 18px;
  border: 1px solid var(--eia-border-accent, rgb(116 216 168 / 0.33));
  border-radius: var(--eia-radius-control, 13px);
  background: var(--eia-material-primary, linear-gradient(130deg, rgb(19 121 79), rgb(11 97 64)));
  color: var(--eia-color-on-accent, white);
  font: inherit;
  font-size: var(--eia-type-control, 0.875rem);
  font-weight: 650;
  cursor: pointer;
}
:where(.dispara-ge-link) {
  color: var(--eia-color-accent-text, rgb(141 231 187));
  font-size: var(--eia-type-control, 0.875rem);
  font-weight: 550;
  text-decoration: underline;
  text-underline-offset: 4px;
}
:where(.dispara-ge-actions .eia-button, .dispara-ge-link):focus-visible {
  outline: 2px solid var(--eia-color-focus, rgb(145 242 195));
  outline-offset: 3px;
}
:where(.dispara-ge-code) {
  margin: 8px 0 0;
  color: var(--eia-color-text-subtle, rgb(146 159 150));
  font-size: var(--eia-type-caption, 0.75rem);
}
`

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('Falha no layout raiz do app', error.digest ? { digest: error.digest } : error)
  }, [error])

  return (
    <html lang="pt-BR">
      <body className="eia-theme dispara-ge">
        <title>{`Algo deu errado · ${BRAND.name}`}</title>
        <style>{FALLBACK_CSS}</style>
        <main className="dispara-ge-card">
          <h1 className="dispara-ge-title">O {BRAND.name} encontrou um problema</h1>
          <p className="dispara-ge-text">
            Tente de novo. Se o problema continuar, volte ao início ou aguarde alguns minutos.
          </p>
          <div className="dispara-ge-actions">
            <EiaButton onClick={reset}>Tentar de novo</EiaButton>
            {/* <a> e não next/link: recarrega a página inteira, inclusive o layout
                raiz que falhou (a navegação no cliente reaproveitaria o estado quebrado). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga completa intencional */}
            <a className="dispara-ge-link" href="/">
              Voltar ao início
            </a>
          </div>
          {error.digest && <p className="dispara-ge-code">Código do erro: {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}
