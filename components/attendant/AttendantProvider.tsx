'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { AttendantPermissions } from '@/types'

// =============================================================================
// TYPES
// =============================================================================

interface AttendantInfo {
  id: string
  name: string
  permissions: AttendantPermissions
}

interface AttendantContextType {
  // Estado
  isReady: boolean
  isValidating: boolean
  isAuthenticated: boolean
  error: string | null

  // Atendente
  attendant: AttendantInfo | null
  token: string | null

  // Permissões
  canView: boolean
  canReply: boolean
  canHandoff: boolean

  // Ações
  logout: () => Promise<void>
}

interface ValidateResponse {
  valid?: boolean
  error?: string
  attendant?: AttendantInfo
}

// =============================================================================
// CONSTANTS
// =============================================================================

const VALIDATE_URL = '/api/attendants/validate'

// =============================================================================
// CONTEXT
// =============================================================================

const AttendantContext = createContext<AttendantContextType | null>(null)

// =============================================================================
// PROVIDER
// =============================================================================

interface AttendantProviderProps {
  children: ReactNode
  token: string | null
}

export function AttendantProvider({ children, token }: AttendantProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [isValidating, setIsValidating] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attendant, setAttendant] = useState<AttendantInfo | null>(null)
  const authenticatedRef = useRef(false)

  // Com ?token → POST (valida e grava o cookie); sem ?token → GET (restaura do cookie).
  // A navegação interna não leva mais o ?token= na URL: a sessão segue pelo cookie httpOnly.
  useEffect(() => {
    // Já autenticado e a URL nova não tem ?token= (navegação interna): nada a revalidar.
    if (!token && authenticatedRef.current) return

    let cancelled = false
    // Revalidação com sessão ativa (ex.: voltar para o link com ?token=) não pisca o loading
    if (!authenticatedRef.current) setIsValidating(true)

    const validate = async () => {
      try {
        const res = token
          ? await fetch(VALIDATE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ token }),
            })
          : await fetch(VALIDATE_URL, {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
            })

        const data = (await res.json().catch(() => ({}))) as ValidateResponse
        if (cancelled) return

        if (res.ok && data.valid && data.attendant) {
          authenticatedRef.current = true
          setAttendant(data.attendant)
          setIsAuthenticated(true)
          setError(null)
        } else {
          authenticatedRef.current = false
          setAttendant(null)
          setIsAuthenticated(false)
          setError(data.error || (token ? 'Token inválido' : 'Token não informado'))
        }
      } catch (err) {
        if (cancelled) return
        console.error('[AttendantProvider] Erro ao validar token:', err)
        authenticatedRef.current = false
        setAttendant(null)
        setError('Erro ao validar token')
        setIsAuthenticated(false)
      } finally {
        if (!cancelled) {
          setIsValidating(false)
          setIsReady(true)
        }
      }
    }

    validate()

    return () => {
      cancelled = true
    }
  }, [token])

  // Logout: apaga o cookie no servidor e zera o estado local
  const logout = useCallback(async () => {
    try {
      await fetch(VALIDATE_URL, { method: 'DELETE', credentials: 'same-origin' })
    } catch (err) {
      console.error('[AttendantProvider] Erro ao encerrar sessão:', err)
    }
    authenticatedRef.current = false
    setAttendant(null)
    setIsAuthenticated(false)
    setError('Sessão encerrada')
  }, [])

  // Permissões derivadas
  const canView = attendant?.permissions.canView ?? false
  const canReply = attendant?.permissions.canReply ?? false
  const canHandoff = attendant?.permissions.canHandoff ?? false

  const contextValue: AttendantContextType = {
    isReady,
    isValidating,
    isAuthenticated,
    error,
    attendant,
    token,
    canView,
    canReply,
    canHandoff,
    logout,
  }

  return (
    <AttendantContext.Provider value={contextValue}>
      {children}
    </AttendantContext.Provider>
  )
}

// =============================================================================
// HOOK
// =============================================================================

export function useAttendant() {
  const context = useContext(AttendantContext)
  if (!context) {
    throw new Error('useAttendant must be used within AttendantProvider')
  }
  return context
}
