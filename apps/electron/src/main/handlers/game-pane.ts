import { RPC_CHANNELS } from '../../shared/types'
import type { GamePaneBounds } from '../../shared/types'
import { BrowserWindow, dialog, webContents } from 'electron'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import JSZip from 'jszip'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize } from 'node:path'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamePane.START,
  RPC_CHANNELS.gamePane.STOP,
  RPC_CHANNELS.gamePane.RELOAD,
  RPC_CHANNELS.gamePane.SET_BOUNDS,
  RPC_CHANNELS.gamePane.SET_VISIBLE,
  RPC_CHANNELS.gamePane.CAPTURE,
  RPC_CHANNELS.gamestudio.EXPORT_ZIP,
  RPC_CHANNELS.gamestudio.IMPORT_ZIP,
] as const

export function registerGamePaneHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { gamePaneManager, gameServerManager, platform } = deps
  if (!gameServerManager) return

  gameServerManager.setChangeListener(event => {
    if (!event.workspaceId) return
    pushTyped(
      server,
      RPC_CHANNELS.gamestudio.CHANGED,
      { to: 'workspace', workspaceId: event.workspaceId },
      { workspaceId: event.workspaceId, projectId: event.projectId, kind: event.kind },
    )
  })

  gameServerManager.setRuntimeEventListener(event => {
    pushTyped(server, RPC_CHANNELS.gamePane.EVENT, { to: 'all' }, event)
  })

  gamePaneManager?.setEventEmitter(event => {
    pushTyped(server, RPC_CHANNELS.gamePane.EVENT, { to: 'all' }, event)
  })

  server.handle(RPC_CHANNELS.gamePane.START, async (ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    try {
      const projectDir = getGameProjectDir(workspace.rootPath, projectId)
      const result = await gameServerManager.start(projectDir, { workspaceId })
      if (gamePaneManager) {
        if (ctx.webContentsId == null) throw new Error('Game pane start requires an Electron host window')
        gamePaneManager.attach(ctx.webContentsId, workspaceId, projectId, projectDir, result.port)
      }
      return result
    } catch (err) {
      platform.logger.error(`[game-pane] start failed for ${projectId}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.gamePane.STOP, async (ctx, projectId: string) => {
    try {
      gamePaneManager?.detach(projectId, ctx.webContentsId ?? undefined)
      await gameServerManager.stop(projectId)
    } catch (err) {
      platform.logger.error(`[game-pane] stop failed for ${projectId}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.gamePane.RELOAD, (_ctx, projectId: string) => {
    gamePaneManager?.reload(projectId)
  })
  server.handle(RPC_CHANNELS.gamePane.SET_BOUNDS, (ctx, projectId: string, bounds: GamePaneBounds) => {
    if (ctx.webContentsId == null) return
    gamePaneManager?.setBounds(ctx.webContentsId, projectId, bounds)
  })
  server.handle(RPC_CHANNELS.gamePane.SET_VISIBLE, (ctx, projectId: string, visible: boolean) => {
    if (ctx.webContentsId == null) return
    gamePaneManager?.setVisible(ctx.webContentsId, projectId, visible)
  })
  server.handle(RPC_CHANNELS.gamePane.CAPTURE, async (_ctx, projectId: string) => {
    return await gamePaneManager?.capture(projectId) ?? null
  })

  server.handle(RPC_CHANNELS.gamestudio.EXPORT_ZIP, async (ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const projectDir = getGameProjectDir(workspace.rootPath, projectId)
    const project = await readGameProjectName(projectDir)
    const host = ctx.webContentsId == null ? null : webContents.fromId(ctx.webContentsId)
    const window = host ? BrowserWindow.fromWebContents(host) : null
    const saveOptions = {
      title: 'Export Game Studio project',
      defaultPath: `${safeFileBase(project)}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    }
    const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return null

    const zip = new JSZip()
    await addDirectoryToZip(zip, projectDir, '')
    await writeFile(result.filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    return result.filePath
  })

  server.handle(RPC_CHANNELS.gamestudio.IMPORT_ZIP, async (_ctx, workspaceId: string, projectId: string, zipPath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const projectDir = getGameProjectDir(workspace.rootPath, projectId)
    const zip = await JSZip.loadAsync(await readFile(zipPath))
    const writes: Promise<void>[] = []
    zip.forEach((relativePath, file) => {
      if (file.dir || isDeniedZipPath(relativePath)) return
      const targetPath = join(projectDir, normalize(relativePath))
      writes.push((async () => {
        await mkdir(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, await file.async('nodebuffer'))
      })())
    })
    await Promise.all(writes)
    pushTyped(server, RPC_CHANNELS.gamestudio.CHANGED, { to: 'workspace', workspaceId }, { workspaceId, projectId, kind: 'files' })
  })
}

function getGameProjectDir(workspaceRootPath: string, projectId: string): string {
  if (!projectId || basename(projectId) !== projectId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(projectId)) {
    throw new Error(`Invalid game project id: ${JSON.stringify(projectId)}`)
  }
  return join(workspaceRootPath, 'gamestudio', projectId)
}

async function addDirectoryToZip(zip: JSZip, directory: string, prefix: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (isDeniedZipPath(relativePath)) continue
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, absolutePath, relativePath)
    } else if (entry.isFile()) {
      zip.file(relativePath, await readFile(absolutePath))
    }
  }
}

function isDeniedZipPath(relativePath: string): boolean {
  const normalized = normalize(relativePath).replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) return true
  const parts = normalized.split('/')
  return parts.some(part => part === '.git' || part === '.agents' || part === 'project.json' || part.startsWith('.thumbnail-'))
}

async function readGameProjectName(projectDir: string): Promise<string> {
  const filePath = join(projectDir, 'project.json')
  if (!existsSync(filePath)) return basename(projectDir)
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as { name?: unknown }
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : basename(projectDir)
  } catch {
    return basename(projectDir)
  }
}

function safeFileBase(input: string): string {
  return input.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^\.+/, '').trim() || 'game-project'
}
