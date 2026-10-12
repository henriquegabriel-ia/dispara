import { beforeEach, describe, expect, it, vi } from 'vitest'

const manager = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({ toast: manager }))

import { markToasterReady, resetToastQueueForTests, toast } from './toast'

describe('lib/toast (sonner → toast do DS)', () => {
  beforeEach(() => {
    manager.add.mockReset()
    manager.close.mockReset()
    resetToastQueueForTests()
  })

  it('enfileira até o DisparaToaster se inscrever e entrega na ordem', () => {
    toast.success('Salvo')
    toast.error('Falhou')
    expect(manager.add).not.toHaveBeenCalled()

    markToasterReady()

    expect(manager.add).toHaveBeenCalledTimes(2)
    expect(manager.add.mock.calls[0][0]).toMatchObject({ title: 'Salvo', type: 'success' })
    expect(manager.add.mock.calls[1][0]).toMatchObject({ title: 'Falhou', type: 'error', priority: 'high' })
  })

  it('depois de pronto entrega na hora, com description e duração', () => {
    markToasterReady()
    toast.info('Sincronizado', { description: '12 templates', duration: 8000 })
    expect(manager.add).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sincronizado', description: '12 templates', type: 'info', timeout: 8000 }),
    )
  })

  it('id explícito é repassado (o mesmo id atualiza o toast em vez de empilhar)', () => {
    markToasterReady()
    const a = toast.warning('Fila cheia', { id: 'fila' })
    const b = toast.warning('Fila cheia', { id: 'fila' })
    expect(a).toBe('fila')
    expect(b).toBe('fila')
    expect(manager.add.mock.calls.map((c) => c[0].id)).toEqual(['fila', 'fila'])
    expect(manager.add.mock.calls[0][0]).toMatchObject({ type: 'warning', priority: 'high' })
  })

  it('sem id gera ids distintos', () => {
    markToasterReady()
    expect(toast.success('a')).not.toBe(toast.success('b'))
  })

  it('loading e duration Infinity ficam abertos (timeout 0); padrão é 5 s', () => {
    markToasterReady()
    toast.loading('Enviando…')
    toast.message('Fixo', { duration: Infinity })
    toast.success('Normal')
    expect(manager.add.mock.calls.map((c) => c[0].timeout)).toEqual([0, 0, 5000])
    expect(manager.add.mock.calls[1][0].type).toBeUndefined()
  })

  it('dismiss fecha um toast ou todos', () => {
    markToasterReady()
    toast.dismiss('x')
    toast.dismiss()
    expect(manager.close.mock.calls).toEqual([['x'], [undefined]])
  })

  it('promise troca o loading por sucesso ou erro no mesmo toast', async () => {
    markToasterReady()
    await toast.promise(Promise.resolve(3), { loading: 'Importando…', success: (n) => `${n} contatos`, error: 'Erro' })
    await Promise.resolve()
    const [loading, done] = manager.add.mock.calls.map((c) => c[0])
    expect(loading).toMatchObject({ type: 'loading', title: 'Importando…' })
    expect(done).toMatchObject({ type: 'success', title: '3 contatos', id: loading.id })

    manager.add.mockClear()
    await expect(
      toast.promise(Promise.reject(new Error('boom')), { loading: 'L', success: 'S', error: (e) => (e as Error).message }),
    ).rejects.toThrow('boom')
    await Promise.resolve()
    expect(manager.add.mock.calls[1][0]).toMatchObject({ type: 'error', title: 'boom' })
  })
})
