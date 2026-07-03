/**
 * GameStudioPage
 *
 * Minimal placeholder for gamestudio mode routing. Replaced by the full Game
 * Studio UI in later milestones.
 */

import { useTranslation } from 'react-i18next'

export interface GameStudioPageProps {
  workspaceId: string
  projectId: string | null
}

export default function GameStudioPage({ workspaceId: _workspaceId, projectId }: GameStudioPageProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <p className="text-lg font-medium text-foreground">{t('appMode.gamestudio')}</p>
      {projectId ? (
        <p className="text-sm font-mono">{projectId}</p>
      ) : null}
    </div>
  )
}
