import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { AttendantToken, UpdateAttendantTokenDTO } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// =============================================================================
// GET - Buscar token específico
// =============================================================================

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from('attendant_tokens')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Token não encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json(data as AttendantToken);
  } catch (error) {
    console.error('[API] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH - Atualizar token
// =============================================================================

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body: UpdateAttendantTokenDTO = await request.json();

    // Preparar dados para atualização
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: 'Nome não pode ser vazio' },
          { status: 400 }
        );
      }
      updateData.name = body.name.trim();
    }

    if (body.permissions !== undefined) {
      updateData.permissions = body.permissions;
    }

    if (body.is_active !== undefined) {
      updateData.is_active = body.is_active;
    }

    if (body.expires_at !== undefined) {
      updateData.expires_at = body.expires_at;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'Nenhum campo para atualizar' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('attendant_tokens')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[API] Erro ao atualizar token:', error);
      return NextResponse.json(
        { error: 'Erro ao atualizar token' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Token não encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json(data as AttendantToken);
  } catch (error) {
    console.error('[API] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE - Remover token
// =============================================================================

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from('attendant_tokens')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[API] Erro ao deletar token:', error);
      return NextResponse.json(
        { error: 'Erro ao remover token' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
