import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { AttendantToken } from '@/types';

// =============================================================================
// POST - Validar token e registrar acesso
// =============================================================================

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'Token não informado' },
        { status: 400 }
      );
    }

    // Buscar token
    const { data, error } = await supabase
      .from('attendant_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { valid: false, error: 'Token inválido' },
        { status: 401 }
      );
    }

    const attendant = data as AttendantToken;

    // Verificar se está ativo
    if (!attendant.is_active) {
      return NextResponse.json(
        { valid: false, error: 'Token desativado' },
        { status: 401 }
      );
    }

    // Verificar expiração
    if (attendant.expires_at && new Date(attendant.expires_at) < new Date()) {
      return NextResponse.json(
        { valid: false, error: 'Token expirado' },
        { status: 401 }
      );
    }

    // Atualizar último acesso e contador
    await supabase
      .from('attendant_tokens')
      .update({
        last_used_at: new Date().toISOString(),
        access_count: attendant.access_count + 1,
      })
      .eq('id', attendant.id);

    // Retornar dados do atendente (sem o token em si)
    return NextResponse.json({
      valid: true,
      attendant: {
        id: attendant.id,
        name: attendant.name,
        permissions: attendant.permissions,
      },
    });
  } catch (error) {
    console.error('[API] Erro ao validar token:', error);
    return NextResponse.json(
      { valid: false, error: 'Erro ao validar token' },
      { status: 500 }
    );
  }
}
