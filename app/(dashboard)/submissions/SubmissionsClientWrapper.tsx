'use client'

import { useSubmissionsController } from '@/hooks/useSubmissions'
import { SubmissionsView } from '@/components/features/submissions/SubmissionsView'
import type { SubmissionsInitialData } from '@/app/(dashboard)/submissions/actions'

interface SubmissionsClientWrapperProps {
  initialData: SubmissionsInitialData | null
  campaignId?: string
  flowId?: string
}

export function SubmissionsClientWrapper({
  initialData,
  campaignId,
  flowId,
}: SubmissionsClientWrapperProps) {
  const controller = useSubmissionsController({
    campaignId,
    flowId,
    initialData: initialData ?? undefined,
  })

  // Ajusta título/descrição baseado nos filtros (mesmos termos do menu: Submissões, MiniApps)
  const title = campaignId
    ? 'Submissões da campanha'
    : flowId
      ? 'Submissões do MiniApp'
      : 'Submissões'

  const description = campaignId
    ? 'Respostas dos formulários MiniApp enviadas nesta campanha.'
    : flowId
      ? 'Respostas deste formulário MiniApp.'
      : 'Respostas de todos os formulários MiniApp.'

  return (
    <SubmissionsView
      controller={controller}
      title={title}
      description={description}
      campaignId={campaignId}
      flowId={flowId}
    />
  )
}
