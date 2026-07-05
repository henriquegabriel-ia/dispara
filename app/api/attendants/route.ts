import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { randomBytes } from 'crypto';
import type {
  AttendantToken,
  CreateAttendantTokenDTO,
  UpdateAttendantTokenDTO,
} from '@/types';

// =============================================================================
// GET - Listar todos os tokens de atendentes
// =============================================================================

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('attendant_tokens')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API] Erro ao buscar tokens:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar tokens de atendentes' },
        { status: 500 }
      );
    }

    return NextResponse.json(data as AttendantToken[]);
  } catch (error) {
    console.error('[API] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Criar novo token de atendente
// =============================================================================

export async function POST(request: Request) {
  try {
    const body: CreateAttendantTokenDTO = await request.json();

    // Validação básica
    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: 'Nome do atendente é obrigatório' },
        { status: 400 }
      );
    }

    // Gerar token único (16 bytes = 32 caracteres hex)
    const token = randomBytes(16).toString('hex');

    // Permissões padrão se não informadas
    const permissions = body.permissions || {
      canView: true,
      canReply: true,
      canHandoff: false,
    };

    const { data, error } = await supabase
      .from('attendant_tokens')
      .insert({
        name: body.name.trim(),
        token,
        permissions,
        expires_at: body.expires_at || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Erro ao criar token:', error);
      return NextResponse.json(
        { error: 'Erro ao criar token de atendente' },
        { status: 500 }
      );
    }

    return NextResponse.json(data as AttendantToken, { status: 201 });
  } catch (error) {
    console.error('[API] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
