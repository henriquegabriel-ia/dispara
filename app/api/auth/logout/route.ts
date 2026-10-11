/**
 * Logout API
 * 
 * POST: Logout and clear session
 *
 * Também apaga o cookie de atendente (`dispara_attendant`): se o dono abriu um link
 * de atendente neste navegador para testar, sair do dashboard não pode deixar a PWA
 * /atendimento aberta para a próxima pessoa no mesmo computador.
 */

import { NextResponse } from 'next/server'
import { ATTENDANT_COOKIE_NAME } from '@/lib/attendant-auth'
import { logoutUser } from '@/lib/user-auth'

export async function POST() {
  try {
    await logoutUser()
    
    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(ATTENDANT_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return response
    
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Erro ao fazer logout' },
      { status: 500 }
    )
  }
}
