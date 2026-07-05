'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useCampaignFolders } from '@/hooks/useCampaignFolders'
import { FolderIcon, FolderOpenIcon, FileIcon, SettingsIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CampaignFolder } from '@/types'

interface CampaignFolderSidebarProps {
  selectedFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
  onManageFolders: () => void
  className?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}

/**
 * Sidebar com lista de pastas para filtrar campanhas
 */
export function CampaignFolderSidebar({
  selectedFolderId,
  onSelectFolder,
  onManageFolders,
  className,
  collapsed = false,
  onToggleCollapse,
}: CampaignFolderSidebarProps) {
  const { folders, totalCount, unfiledCount, isLoading } = useCampaignFolders()

  const isSelected = (folderId: string | null) => {
    if (folderId === null) return selectedFolderId === null
    return selectedFolderId === folderId
  }

  if (collapsed) {
    return (
      <div className={cn('flex flex-col items-center py-4 w-12 border-r border-slate-800 bg-slate-900', className)}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="mb-4"
          title="Expandir sidebar"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </Button>

        <button
          onClick={() => onSelectFolder(null)}
          className={cn(
            'p-2 rounded-md transition-colors',
            isSelected(null)
              ? 'bg-primary-500/20 text-primary-400'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          )}
          title={`Todas (${totalCount})`}
        >
          <FolderOpenIcon className="h-5 w-5" />
        </button>

        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => onSelectFolder(folder.id)}
            className={cn(
              'p-2 rounded-md transition-colors mt-1',
              isSelected(folder.id)
                ? 'bg-primary-500/20 text-primary-400'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            )}
            title={`${folder.name} (${folder.campaignCount || 0})`}
          >
            <FolderIcon className="h-5 w-5" style={{ color: folder.color }} />
          </button>
        ))}

        <button
          onClick={() => onSelectFolder('none')}
          className={cn(
            'p-2 rounded-md transition-colors mt-1',
            isSelected('none')
              ? 'bg-primary-500/20 text-primary-400'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          )}
          title={`Sem pasta (${unfiledCount})`}
        >
          <FileIcon className="h-5 w-5" />
        </button>

        <div className="flex-1" />

        <button
          onClick={onManageFolders}
          className="p-2 rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          title="Gerenciar pastas"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col w-56 border-r border-slate-800 bg-slate-900', className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Pastas
        </span>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="h-6 w-6"
            title="Recolher sidebar"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-primary-500" />
          </div>
        ) : (
          <nav className="space-y-1">
            {/* Todas as campanhas */}
            <FolderItem
              icon={<FolderOpenIcon className="h-4 w-4" />}
              label="Todas"
              count={totalCount}
              isSelected={isSelected(null)}
              onClick={() => onSelectFolder(null)}
            />

            {/* Pastas do usuário */}
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                icon={<FolderIcon className="h-4 w-4" style={{ color: folder.color }} />}
                label={folder.name}
                count={folder.campaignCount || 0}
                isSelected={isSelected(folder.id)}
                onClick={() => onSelectFolder(folder.id)}
              />
            ))}

            {/* Sem pasta */}
            <FolderItem
              icon={<FileIcon className="h-4 w-4 text-slate-500" />}
              label="Sem pasta"
              count={unfiledCount}
              isSelected={isSelected('none')}
              onClick={() => onSelectFolder('none')}
            />
          </nav>
        )}
      </div>

      {/* Gerenciar pastas */}
      <div className="p-2 border-t border-slate-800">
        <Button
          variant="ghost"
          size="sm"
          onClick={onManageFolders}
          className="w-full justify-start text-slate-400 hover:text-slate-200"
        >
          <SettingsIcon className="h-4 w-4 mr-2" />
          Gerenciar
        </Button>
      </div>
    </div>
  )
}

interface FolderItemProps {
  icon: React.ReactNode
  label: string
  count: number
  isSelected: boolean
  onClick: () => void
}

function FolderItem({ icon, label, count, isSelected, onClick }: FolderItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center w-full px-3 py-2 rounded-md text-sm transition-colors',
        isSelected
          ? 'bg-primary-500/20 text-primary-400'
          : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
      )}
    >
      <span className="mr-2">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      <span className={cn(
        'text-xs ml-2',
        isSelected ? 'text-primary-400' : 'text-slate-500'
      )}>
        ({count})
      </span>
    </button>
  )
}
