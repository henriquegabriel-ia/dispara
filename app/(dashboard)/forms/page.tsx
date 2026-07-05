import { Suspense } from 'react'
import { getFormsInitialData } from './actions'
import { FormsClientWrapper } from './FormsClientWrapper'
import { FormsSkeleton } from '@/components/features/lead-forms/FormsSkeleton'

// ISR: revalida a cada 2 minutos (forms mudam pouco)
export const revalidate = 120

async function FormsWithData() {
  const initialData = await getFormsInitialData()
  return <FormsClientWrapper initialData={initialData} />
}

/**
 * Forms Page - RSC Híbrido
 */
export default function FormsPage() {
  return (
    <Suspense fallback={<FormsSkeleton />}>
      <FormsWithData />
    </Suspense>
  )
}
