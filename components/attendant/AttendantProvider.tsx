'use client'

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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
}

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

  // Validar token na montagem
  useEffect(() => {
    if (!token) {
      setIsValidating(false)
      setIsReady(true)
      setError('Token não informado')
      return
    }

    const validateToken = async () => {
      try {
        const res = await fetch('/api/attendants/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })

        const data = await res.json()

        if (data.valid) {
          setAttendant(data.attendant)
          setIsAuthenticated(true)
          setError(null)
        } else {
          setError(data.error || 'Token inválido')
          setIsAuthenticated(false)
        }
      } catch (err) {
        console.error('[AttendantProvider] Erro ao validar token:', err)
        setError('Erro ao validar token')
        setIsAuthenticated(false)
      } finally {
        setIsValidating(false)
        setIsReady(true)
      }
    }

    validateToken()
  }, [token])

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
