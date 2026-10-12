import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Providers } from './providers'
import { DisparaToaster } from '@/components/app/DisparaToaster'
import { EiaThemeScript } from '@/components/eia/theme'
import { BRAND } from '@/lib/branding'

// Manrope variável do DS Empreende IA V2 (OFL, public/fonts). O nome de família
// gerado pelo next/font entra nos tokens --eia-font-* via styles/dispara-eia.css.
const manrope = localFont({
  src: '../public/fonts/Manrope-Variable.ttf',
  weight: '200 800',
  display: 'swap',
  variable: '--font-manrope',
  fallback: ['Arial', 'sans-serif'],
})

// Preferência de tema salva pelo next-themes (chave "theme") migra uma vez para
// a chave do DS antes do EiaThemeScript ler. Remover depois de alguns meses.
const LEGACY_THEME_KEY_MIGRATION =
  "(function(){try{var k='empreende-ia-theme';if(localStorage.getItem(k)===null){var v=localStorage.getItem('theme');if(v==='light'||v==='dark'||v==='system')localStorage.setItem(k,v)}}catch(e){}})()"

export const viewport: Viewport = {
  // Escuro é o padrão do DS mesmo com o sistema claro: --eia-color-bg escuro.
  themeColor: '#080a09',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: `${BRAND.name} — Disparos e Automação no WhatsApp API Oficial`,
  description: 'Campanhas, automações e atendimento com IA no WhatsApp API Oficial (Meta Cloud API).',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: BRAND.name,
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // Tema do DS: EiaThemeScript grava data-eia-theme no <html> antes da pintura
    // (escuro por padrão); suppressHydrationWarning cobre esses atributos.
    // .eia-theme no <body> abre o escopo dos tokens --eia-* para o app e os portais.
    <html lang="pt-BR" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LEGACY_THEME_KEY_MIGRATION }} />
        <EiaThemeScript />
      </head>
      <body className="eia-theme font-sans antialiased">
        <Providers>
          <DisparaToaster />
          {children}
        </Providers>
      </body>
    </html>
  )
}
