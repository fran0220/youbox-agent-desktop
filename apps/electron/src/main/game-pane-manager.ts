import { BrowserView, session, type BrowserWindow, type Session as ElectronSession } from 'electron'
import { GAME_SERVER_HOST } from './game-server-manager'
import { mainLog } from './logger'
import type { GamePaneBounds, GamePaneEvent } from '../shared/types'

const GAME_PANE_PARTITION_PREFIX = 'game-pane-'

interface GamePaneEntry {
  projectId: string
  window: BrowserWindow
  view: BrowserView
  port: number
  visible: boolean
  bounds: GamePaneBounds
}

export type GamePaneEventSink = (event: GamePaneEvent) => void

export class GamePaneManager {
  private readonly panes = new Map<string, GamePaneEntry>()
  private eventSink?: GamePaneEventSink

  setEventSink(sink: GamePaneEventSink): void {
    this.eventSink = sink
  }

  async attach(projectId: string, window: BrowserWindow, port: number): Promise<void> {
    const existing = this.panes.get(projectId)
    if (existing && existing.window === window && !existing.view.webContents.isDestroyed()) {
      existing.port = port
      await this.load(projectId)
      return
    }

    if (existing) this.destroy(projectId)

    const partition = `${GAME_PANE_PARTITION_PREFIX}${projectId}`
    const ses = session.fromPartition(partition)
    this.configurePermissions(ses, port)

    const view = new BrowserView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition,
      },
    })
    const entry: GamePaneEntry = {
      projectId,
      window,
      view,
      port,
      visible: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
    this.panes.set(projectId, entry)
    window.addBrowserView(view)
    this.setupViewListeners(entry)
    this.emit({ projectId, type: 'state', payload: { state: 'loading', port } })
    await this.load(projectId)
  }

  destroy(projectId: string): void {
    const entry = this.panes.get(projectId)
    if (!entry) return
    this.panes.delete(projectId)
    try {
      if (!entry.window.isDestroyed()) entry.window.removeBrowserView(entry.view)
    } catch (err) {
      mainLog.warn(`[game-pane] removeBrowserView failed project=${projectId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!entry.view.webContents.isDestroyed()) {
      const destroyableWebContents = entry.view.webContents as typeof entry.view.webContents & { destroy?: () => void }
      destroyableWebContents.destroy?.()
    }
    this.emit({ projectId, type: 'state', payload: { state: 'stopped' } })
  }

  async reload(projectId: string): Promise<void> {
    const entry = this.panes.get(projectId)
    if (!entry || entry.view.webContents.isDestroyed()) return
    entry.view.webContents.reloadIgnoringCache()
  }

  setBounds(projectId: string, bounds: GamePaneBounds): void {
    const entry = this.panes.get(projectId)
    if (!entry) return
    entry.bounds = bounds
    if (!entry.visible || entry.window.isDestroyed()) {
      entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    entry.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    })
  }

  setVisible(projectId: string, visible: boolean): void {
    const entry = this.panes.get(projectId)
    if (!entry) return
    entry.visible = visible
    this.setBounds(projectId, entry.bounds)
  }

  async capture(projectId: string): Promise<string | null> {
    const entry = this.panes.get(projectId)
    if (!entry || entry.view.webContents.isDestroyed()) return null
    const image = await entry.view.webContents.capturePage()
    return image.isEmpty() ? null : image.toDataURL()
  }

  private async load(projectId: string): Promise<void> {
    const entry = this.panes.get(projectId)
    if (!entry || entry.view.webContents.isDestroyed()) return
    await entry.view.webContents.loadURL(`http://${GAME_SERVER_HOST}:${entry.port}/`)
  }

  private configurePermissions(ses: ElectronSession, port: number): void {
    ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const permissionDetails = details as typeof details & { requestingOrigin?: string; requestingUrl?: string }
      const origin = permissionDetails.requestingUrl || permissionDetails.requestingOrigin || ''
      let allowed = false
      try {
        const url = new URL(origin)
        allowed = url.hostname === GAME_SERVER_HOST
          && Number(url.port) === port
          && (permission === 'fullscreen' || permission === 'pointerLock')
      } catch {
        allowed = false
      }
      callback(allowed)
    })
  }

  private setupViewListeners(entry: GamePaneEntry): void {
    const wc = entry.view.webContents
    const allowedOrigin = `http://${GAME_SERVER_HOST}:${entry.port}`

    wc.setWindowOpenHandler(() => ({ action: 'deny' }))

    wc.on('will-navigate', (event, url) => {
      if (!url.startsWith(allowedOrigin)) event.preventDefault()
    })
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      this.emit({
        projectId: entry.projectId,
        type: 'console',
        payload: {
          level: level >= 2 ? 'error' : level === 1 ? 'warn' : 'log',
          message,
          line,
          source: sourceId,
          timestamp: Date.now(),
        },
      })
    })
    wc.on('did-finish-load', () => {
      this.emit({ projectId: entry.projectId, type: 'state', payload: { state: 'ready', port: entry.port } })
    })
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.emit({ projectId: entry.projectId, type: 'load-failed', payload: { errorCode, errorDescription, url: validatedURL } })
    })
    wc.on('render-process-gone', (_event, details) => {
      this.emit({ projectId: entry.projectId, type: 'crashed', payload: details })
    })
    wc.on('unresponsive', () => {
      this.emit({ projectId: entry.projectId, type: 'unresponsive' })
    })
    entry.window.on('closed', () => this.destroy(entry.projectId))
  }

  private emit(event: GamePaneEvent): void {
    this.eventSink?.(event)
  }
}
