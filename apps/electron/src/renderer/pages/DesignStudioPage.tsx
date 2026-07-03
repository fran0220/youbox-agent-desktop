import { PenTool } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface DesignStudioPageProps {
  workspaceId: string
  projectId: string | null
}

export default function DesignStudioPage({ workspaceId, projectId }: DesignStudioPageProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex h-full w-full select-none flex-col items-center justify-center gap-3 bg-background text-center"
      data-testid="design-studio-page"
      data-workspace-id={workspaceId}
      data-project-id={projectId ?? undefined}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <PenTool className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('appMode.design')}</h2>
        {projectId && (
          <p className="max-w-sm font-mono text-xs text-muted-foreground">
            {projectId}
          </p>
        )}
      </div>
    </div>
  )
}
