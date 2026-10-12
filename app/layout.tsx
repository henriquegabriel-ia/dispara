import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { ThemedToaster } from '@/components/app/themed-toaster'
import { BRAND } from '@/lib/branding'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
})

export const viewport: Viewport = {
  // Dark-only: mesma cor nos dois esquemas (brand bg-base)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#030712' },
    { media: '(prefers-color-scheme: dark)', color: '#030712' },
  ],
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
    // Classe de tema (dark|light) é gerenciada pelo next-themes (Providers);
    // dark é o default. suppressHydrationWarning cobre a troca no client.
    <html lang="pt-BR" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <ThemedToaster />
          {children}
        </Providers>
      </body>
    </html>
  )
}
