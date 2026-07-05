'use client'

/**
 * Login Page
 * 
 * Simple password login for single-tenant DaaS
 */

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock, Eye, EyeOff, LogIn } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/'

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // Whitelabel: brand vem no payload de /api/auth/status (sem request extra)
  const [brand, setBrand] = useState<{ name: string; logoUrl: string; primaryColor: string } | null>(null)
  const [isLocalhost, setIsLocalhost] = useState(false)
  const [isConfigured, setIsConfigured] = useState(true)

  useEffect(() => {
    try {
      const host = window.location.hostname
      setIsLocalhost(host === 'localhost' || host === '127.0.0.1' || host === '::1')
    } catch {
      setIsLocalhost(false)
    }

    // Get company name from auth status
    fetch('/api/auth/status')
      .then(res => {
        return res.json()
      })
      .then(async (data) => {
        if (data.brand?.name) {
          setBrand(data.brand)
        }

        if (!data.isConfigured) {
          setIsConfigured(false)

          // Em localhost, não forçamos o fluxo da Vercel. Mostramos instrução para configurar .env.local.
          if (isLocalhost) {
            setError('Configuração local incompleta: defina MASTER_PASSWORD no .env.local e reinicie o servidor (npm run dev).')
            return
          }

          router.push('/install')
        } else if (!data.isSetup) {
          // Instalação incompleta - redireciona para o wizard
          router.push('/install/wizard')
        } else if (data.isAuthenticated) {
          router.push('/')
        }
      })
      .catch((err) => {
        console.error('🔍 [LOGIN] Auth status error:', err)
      })
  }, [router, isLocalhost])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password) {
      setError('Digite sua senha')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao fazer login')
      }

      // Redirect to original destination or dashboard
      router.push(redirectTo)
      router.refresh()

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="text-center mb-8">
        {brand ? (
          <img
            src={brand.logoUrl}
            alt={brand.name}
            className="h-16 mx-auto mb-4 object-contain"
            onError={(e) => {
              // Fallback para o logo padrão se a URL customizada falhar
              const img = e.currentTarget
              if (img.dataset.fallback !== 'true') {
                img.dataset.fallback = 'true'
                img.src = '/brand/logo.svg'
              }
            }}
          />
        ) : (
          <div className="h-16 mb-4" aria-hidden="true" />
        )}
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">
          {brand ? (
            brand.name
          ) : (
            <span className="inline-block h-7 w-36 rounded-lg bg-[var(--ds-bg-elevated)] animate-pulse align-middle" aria-hidden="true" />
          )}
        </h1>
        <p className="text-[var(--ds-text-secondary)] mt-1">Entre para continuar</p>
      </div>

      {/* Card */}
      <div className="bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-6 shadow-xl">
        {!isConfigured && isLocalhost && (
          <div className="mb-4 bg-[var(--ds-status-success-bg)] border border-[var(--ds-status-success)]/20 rounded-xl p-4">
            <p className="text-sm text-[var(--ds-status-success-text)] font-medium">Modo local</p>
            <p className="text-xs text-[var(--ds-text-secondary)] mt-1">
              Para destravar o login no localhost, defina <code className="bg-[var(--ds-bg-surface)] px-1.5 py-0.5 rounded">MASTER_PASSWORD</code> no <code className="bg-[var(--ds-bg-surface)] px-1.5 py-0.5 rounded">.env.local</code> e reinicie o dev server.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ds-text-muted)]" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              name="password"
              autoComplete="current-password"
              className="w-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] rounded-xl pl-11 pr-11 py-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)]"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {error && (
            <p className="mt-4 text-[var(--ds-status-error-text)] text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || (!isConfigured && isLocalhost)}
            className="w-full mt-6 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Entrar
                <LogIn className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="text-center text-[var(--ds-text-muted)] text-sm mt-6">
        {brand ? `${brand.name} © ${new Date().getFullYear()}` : ' '}
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      }>
        <LoginForm />
      </Suspense>
    </div>
  )
}
