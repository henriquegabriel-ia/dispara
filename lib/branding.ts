/**
 * Marca do produto (fixa).
 *
 * O whitelabel (nome/logo/cor por instalação, chaves brand_* em settings) foi
 * removido na migração para o Design System Empreende IA V2: a identidade é a
 * do DS (esmeralda pontual, Manrope) com o wordmark do Dispara. As chaves
 * brand_* que existirem no banco ficam inertes.
 */
export const BRAND = {
  name: 'Dispara',
  logoUrl: '/brand/logo.svg',
  /** theme_color do manifest da PWA */
  themeColor: '#10b981',
} as const
