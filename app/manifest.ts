/**
 * PWA Manifest — servido em /manifest.webmanifest (marca fixa: lib/branding.ts).
 */

import type { MetadataRoute } from 'next'
import { BRAND } from '@/lib/branding'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: 'Disparos, automação e atendimento com IA no WhatsApp API Oficial',
    start_url: '/atendimento',
    scope: '/atendimento',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#030712',
    theme_color: BRAND.themeColor,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    categories: ['business', 'productivity'],
    lang: 'pt-BR',
    dir: 'ltr',
    prefer_related_applications: false,
    shortcuts: [
      {
        name: 'Conversas Urgentes',
        short_name: 'Urgentes',
        description: 'Ver conversas que precisam de atenção',
        url: '/atendimento?filter=urgent',
        icons: [{ src: '/icons/shortcut-urgent.png', sizes: '96x96' }],
      },
    ],
  }
}
