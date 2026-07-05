/**
 * Logout API
 * 
 * POST: Logout and clear session
 */

import { NextResponse } from 'next/server'
import { logoutUser } from '@/lib/user-auth'

export async function POST() {
  try {
    await logoutUser()
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Erro ao fazer logout' },
      { status: 500 }
    )
  }
}
