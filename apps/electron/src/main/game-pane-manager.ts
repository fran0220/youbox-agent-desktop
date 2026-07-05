import { BrowserWindow, WebContentsView, session, webContents, type Session, type WebContents } from 'electron'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { GAME_SERVER_HOST } from './game-server-manager'
import type { GamePaneBounds, GamePaneEvent } from '../shared/types'

const GAME_PANE_PARTITION = 'gamestudio-game-pane'
const THUMBNAIL_WIDTH = 480

export type GamePaneEventEmitter = (event: GamePaneEvent) => void

interface GamePaneInstance {
  projectId: string
  workspaceId: string
  projectDir: string
  port: number
  window: BrowserWindow
  view: WebContentsView
  bounds: GamePaneBounds
  visible: boolean
  htmlFullscreen: boolean
}

export class GamePaneManager {
  private readonly byWindowId = new Map<number, GamePaneInstance>()
  private readonly webContentsIds = new Set<number>()
  private sessionConfigured = false
  private emitEvent?: GamePaneEventEmitter

  constructor(emitEvent?: GamePaneEventEmitter) {
    this.emitEvent = emitEvent
  }

  setEventEmitter(emitEvent: GamePaneEventEmitter): void {
    this.emitEvent = emitEvent
  }

  attach(hostWebContentsId: number, workspaceId: string, projectId: string, projectDir: string, port: number): void {
    const hostWebContents = webContents.fromId(hostWebContentsId)
    const window = hostWebContents ? BrowserWindow.fromWebContents(hostWebContents) : null
    if (!window || window.isDestroyed()) throw new Error('Game pane host window is not available')

    const current = this.byWindowId.get(window.id)
    if (current?.projectId === projectId && current.port === port) {
      current.workspaceId = workspaceId
      current.projectDir = projectDir
      current.visible = true
      this.applyBounds(current)
      current.view.webContents.loadURL(this.urlForPort(port)).catch(() => {})
      return
    }

    this.detachFromWindow(window.id)

    const paneSession = session.fromPartition(GAME_PANE_PARTITION)
    this.configureSession(paneSession)
    const view = new WebContentsView({
      webPreferences: {
        session: paneSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    })
    const instance: GamePaneInstance = {
      projectId,
      workspaceId,
      projectDir,
      port,
      window,
      view,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: true,
      htmlFullscreen: false,
    }

    this.webContentsIds.add(view.webContents.id)
    this.wireView(instance)
    window.contentView.addChildView(view)
    this.byWindowId.set(window.id, instance)
    window.once('closed', () => this.detachFromWindow(window.id))
    void view.webContents.loadURL(this.urlForPort(port))
    this.emit(projectId, { type: 'state', payload: { state: 'loading', port } })
  }

  detach(projectId: string, hostWebContentsId?: number): void {
    for (const [windowId, instance] of this.byWindowId) {
      if (instance.projectId !== projectId) continue
      if (hostWebContentsId !== undefined && instance.window.webContents.id !== hostWebContentsId) continue
      this.detachFromWindow(windowId)
    }
  }

  detachFromWindow(windowId: number): void {
    const instance = this.byWindowId.get(windowId)
    if (!instance) return
    this.byWindowId.delete(windowId)
    this.webContentsIds.delete(instance.view.webContents.id)
    try {
      if (!instance.window.isDestroyed()) instance.window.contentView.removeChildView(instance.view)
    } catch {}
  }

  reload(projectId: string): void {
    for (const instance of this.instancesForProject(projectId)) {
      if (!instance.view.webContents.isDestroyed()) instance.view.webContents.reloadIgnoringCache()
    }
  }

  setBounds(hostWebContentsId: number, projectId: string, bounds: GamePaneBounds): void {
    const instance = this.instanceForHost(hostWebContentsId, projectId)
    if (!instance) return
    instance.bounds = bounds
    this.applyBounds(instance)
  }

  setVisible(hostWebContentsId: number, projectId: string, visible: boolean): void {
    const instance = this.instanceForHost(hostWebContentsId, projectId)
    if (!instance || instance.visible === visible) return
    instance.visible = visible
    this.applyBounds(instance)
  }

  async capture(projectId: string): Promise<string | null> {
    const instance = this.instancesForProject(projectId).find(candidate => candidate.visible && !candidate.view.webContents.isDestroyed())
    if (!instance) return null
    try {
      const image = await instance.view.webContents.capturePage()
      if (image.isEmpty()) return null
      const resized = image.resize({ width: THUMBNAIL_WIDTH, quality: 'good' })
      const thumbnailPath = join(instance.projectDir, 'thumbnail.png')
      const tmpPath = join(instance.projectDir, `.thumbnail-${Date.now()}.tmp.png`)
      await mkdir(dirname(thumbnailPath), { recursive: true })
      await writeFile(tmpPath, resized.toPNG())
      await rename(tmpPath, thumbnailPath)
      return thumbnailPath
    } catch {
      return null
    }
  }

  private configureSession(paneSession: Session): void {
    if (this.sessionConfigured) return
    this.sessionConfigured = true
    paneSession.setPermissionRequestHandler((requestingWebContents, permission, callback) => {
      callback(this.isGamePaneWebContents(requestingWebContents) && this.isAllowedPermission(permission))
    })
    paneSession.setPermissionCheckHandler((requestingWebContents, permission) => {
      return this.isGamePaneWebContents(requestingWebContents) && this.isAllowedPermission(permission)
    })
  }

  private wireView(instance: GamePaneInstance): void {
    const wc = instance.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event, url) => {
      if (!this.isAllowedUrl(instance, url)) event.preventDefault()
    })
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('did-finish-load', () => this.emit(instance.projectId, { type: 'state', payload: { state: 'ready', port: instance.port } }))
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return
      this.emit(instance.projectId, { type: 'load-failed', payload: { errorCode, errorDescription, url: validatedURL } })
    })
    wc.on('render-process-gone', (_event, details) => {
      this.emit(instance.projectId, { type: 'crashed', payload: details })
    })
    wc.on('unresponsive', () => this.emit(instance.projectId, { type: 'unresponsive' }))
    wc.on('enter-html-full-screen', () => {
      instance.htmlFullscreen = true
      this.applyBounds(instance)
      this.emit(instance.projectId, { type: 'state', payload: { state: 'fullscreen', port: instance.port } })
    })
    wc.on('leave-html-full-screen', () => {
      instance.htmlFullscreen = false
      this.applyBounds(instance)
      this.emit(instance.projectId, { type: 'state', payload: { state: 'ready', port: instance.port } })
    })
  }

  private applyBounds(instance: GamePaneInstance): void {
    if (instance.window.isDestroyed() || instance.view.webContents.isDestroyed()) return
    if (!instance.visible) {
      instance.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    if (instance.htmlFullscreen) {
      const [width, height] = instance.window.getContentSize()
      instance.view.setBounds({ x: 0, y: 0, width, height })
      return
    }
    const zoomFactor = instance.window.webContents.getZoomFactor()
    instance.view.setBounds({
      x: Math.round(instance.bounds.x * zoomFactor),
      y: Math.round(instance.bounds.y * zoomFactor),
      width: Math.max(0, Math.round(instance.bounds.width * zoomFactor)),
      height: Math.max(0, Math.round(instance.bounds.height * zoomFactor)),
    })
  }

  private isAllowedUrl(instance: GamePaneInstance, rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl)
      return url.protocol === 'http:' && url.hostname === GAME_SERVER_HOST && url.port === String(instance.port)
    } catch {
      return false
    }
  }

  private isAllowedPermission(permission: string): boolean {
    return permission === 'pointerLock' || permission === 'fullscreen'
  }

  private isGamePaneWebContents(candidate: WebContents | null | undefined): boolean {
    return !!candidate && this.webContentsIds.has(candidate.id)
  }

  private instanceForHost(hostWebContentsId: number, projectId: string): GamePaneInstance | null {
    for (const instance of this.instancesForProject(projectId)) {
      if (instance.window.webContents.id === hostWebContentsId) return instance
    }
    return null
  }

  private instancesForProject(projectId: string): GamePaneInstance[] {
    return [...this.byWindowId.values()].filter(instance => instance.projectId === projectId)
  }

  private urlForPort(port: number): string {
    return `http://${GAME_SERVER_HOST}:${port}/`
  }

  private emit(projectId: string, event: Omit<GamePaneEvent, 'projectId'>): void {
    this.emitEvent?.({ projectId, ...event } as GamePaneEvent)
  }
}
