import {
  IMPORTED_SESSION_LABEL,
  IMPORTED_SESSION_STATUS,
} from '@craft-agent/origincoworks/session-import'
import type { SessionMeta } from '@/atoms/sessions'

export type ImportedSessionMarker = Pick<
  SessionMeta,
  'importedFrom' | 'sessionStatus' | 'labels'
>

export function isImportedSessionMeta(meta: ImportedSessionMarker): boolean {
  if (meta.importedFrom) return true
  if (meta.sessionStatus === IMPORTED_SESSION_STATUS) return true
  const labels = meta.labels ?? []
  return labels.includes(IMPORTED_SESSION_LABEL)
}
