export interface WorkspaceIdLike {
  id: string
}

export function selectInitialWindowWorkspaceId(
  windowWorkspaceId: string | null | undefined,
  workspaces: WorkspaceIdLike[],
): string | null {
  if (windowWorkspaceId && workspaces.some(workspace => workspace.id === windowWorkspaceId)) {
    return windowWorkspaceId
  }

  return workspaces[0]?.id ?? null
}
