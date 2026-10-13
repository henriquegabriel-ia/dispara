'use client'

import { DashboardClientWrapper, type DashboardInitialData } from '@/app/(dashboard)/DashboardClientWrapper'

export function DashboardClientLoader({ initialData }: { initialData?: DashboardInitialData }) {
  return <DashboardClientWrapper initialData={initialData} />
}
