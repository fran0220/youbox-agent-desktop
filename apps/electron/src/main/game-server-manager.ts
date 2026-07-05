import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, extname, normalize, resolve, sep } from 'node:path'
import type { GamePaneConsoleEntry, GamePaneEvent, GamePaneRuntimeErrorPayload } from '@craft-agent/shared/protocol'

export const GAME_SERVER_HOST = '127.0.0.1'
export const GAME_SERVER_PORT_START = 3130
export const GAME_SERVER_PORT_END = 3169
export const GAME_SERVER_WATCH_DEBOUNCE_MS = 500
const GAME_RUNTIME_EVENT_ENDPOINT = '/__craft_gamestudio_event'
const GAME_RUNTIME_EVENT_MAX_BYTES = 64 * 1024

export interface GameServerStartOptions {
  workspaceId?: string
}

export interface GameServerStartResult {
  port: number
}

export interface GameServerChangeEvent {
  workspaceId?: string
  projectId: string
  kind: 'files'
}

export type GameServerChangeListener = (event: GameServerChangeEvent) => void
export type GameServerRuntimeEventListener = (event: GamePaneEvent) => void

interface RunningGameServer {
  projectId: string
  projectDir: string
  projectRealPath: string
  workspaceId?: string
  server: Server
  port: number
  watcher?: FSWatcher
  debounceTimer?: ReturnType<typeof setTimeout>
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json; charset=utf-8',
}

function contentTypeForPath(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isPathInside(childRealPath: string, parentRealPath: string): boolean {
  return childRealPath === parentRealPath || childRealPath.startsWith(parentRealPath.endsWith(sep) ? parentRealPath : parentRealPath + sep)
}

function sendPlain(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end(message)
}

function decodeRequestPath(rawPathname: string): string | null {
  try {
    return decodeURIComponent(rawPathname)
  } catch {
    return null
  }
}

function hasTraversal(decodedPathname: string): boolean {
  return decodedPathname
    .split('/')
    .some(segment => segment === '..')
}

function isAllowedHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.toLowerCase().split(':')[0]
  return host === GAME_SERVER_HOST || host === 'localhost'
}

function isDeniedServePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/')
  return normalized
    .split('/')
    .some(segment => segment === 'project.json' || segment.startsWith('.'))
}

function isIgnoredWatchPath(fileName: string | null): boolean {
  if (!fileName) return true
  const normalized = fileName.replaceAll('\\', '/')
  if (normalized === 'project.json' || normalized.endsWith('/project.json')) return true
  if (normalized === 'thumbnail.png' || normalized.endsWith('/thumbnail.png')) return true
  if (normalized === '.git' || normalized.startsWith('.git/') || normalized.includes('/.git/')) return true
  return normalized === '.agents' || normalized.startsWith('.agents/') || normalized.includes('/.agents/')
}

function injectGameRuntimeBridge(html: string): string {
  if (html.includes('data-craft-gamestudio-runtime')) return html
  const script = `<script data-craft-gamestudio-runtime>
(() => {
  const endpoint = '${GAME_RUNTIME_EVENT_ENDPOINT}';
  const recentConsole = [];
  const safeText = (value) => {
    try {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const send = (payload) => {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return;
      } catch {}
    }
    try { void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); } catch {}
  };
  const pushConsole = (level, args) => {
    const entry = { level, message: args.map(safeText).join(' '), timestamp: Date.now() };
    recentConsole.push(entry);
    if (recentConsole.length > 20) recentConsole.shift();
    send({ type: 'console', payload: entry });
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level];
    console[level] = (...args) => {
      pushConsole(level, args);
      return original.apply(console, args);
    };
  }
  window.addEventListener('error', (event) => {
    send({
      type: 'runtime-error',
      payload: {
        message: event.message || safeText(event.error) || 'Runtime error',
        stack: event.error && event.error.stack ? String(event.error.stack) : undefined,
        source: { fileName: event.filename || undefined, lineNumber: event.lineno || undefined, columnNumber: event.colno || undefined },
        timestamp: Date.now(),
        recentConsole: recentConsole.slice(-10),
      },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send({
      type: 'runtime-error',
      payload: {
        message: safeText(reason) || 'Unhandled promise rejection',
        stack: reason && reason.stack ? String(reason.stack) : undefined,
        timestamp: Date.now(),
        recentConsole: recentConsole.slice(-10),
      },
    });
  });
})();
</script>`
  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`)
  return `${script}${html}`
}

function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let total = 0
    request.on('data', chunk => {
      const buffer = Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        rejectPromise(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')))
    request.on('error', rejectPromise)
  })
}

function normalizeRuntimeEvent(projectId: string, input: unknown): GamePaneEvent | null {
  if (!input || typeof input !== 'object') return null
  const event = input as { type?: unknown; payload?: unknown }
  if (event.type === 'console') {
    const payload = normalizeConsoleEntry(event.payload)
    return payload ? { projectId, type: 'console', payload } : null
  }
  if (event.type === 'runtime-error') {
    const payload = normalizeRuntimeError(event.payload)
    return payload ? { projectId, type: 'runtime-error', payload } : null
  }
  return null
}

function normalizeConsoleEntry(input: unknown): GamePaneConsoleEntry | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Partial<GamePaneConsoleEntry>
  const level = value.level === 'warn' || value.level === 'error' ? value.level : 'log'
  const message = typeof value.message === 'string' ? value.message.slice(0, 4000) : ''
  if (!message) return null
  return {
    level,
    message,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
  }
}

function normalizeRuntimeError(input: unknown): GamePaneRuntimeErrorPayload | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Partial<GamePaneRuntimeErrorPayload>
  const message = typeof value.message === 'string' ? value.message.slice(0, 4000) : ''
  if (!message) return null
  const source = value.source && typeof value.source === 'object'
    ? {
        fileName: typeof value.source.fileName === 'string' ? value.source.fileName.slice(0, 1000) : undefined,
        lineNumber: typeof value.source.lineNumber === 'number' ? value.source.lineNumber : undefined,
        columnNumber: typeof value.source.columnNumber === 'number' ? value.source.columnNumber : undefined,
      }
    : undefined
  return {
    message,
    stack: typeof value.stack === 'string' ? value.stack.slice(0, 8000) : undefined,
    source,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
    recentConsole: Array.isArray(value.recentConsole)
      ? value.recentConsole.flatMap((entry) => {
          const normalized = normalizeConsoleEntry(entry)
          return normalized ? [normalized] : []
        }).slice(-10)
      : [],
  }
}

export class GameServerManager {
  private readonly running = new Map<string, RunningGameServer>()
  private onFilesChanged?: GameServerChangeListener
  private onRuntimeEvent?: GameServerRuntimeEventListener

  constructor(onFilesChanged?: GameServerChangeListener, onRuntimeEvent?: GameServerRuntimeEventListener) {
    this.onFilesChanged = onFilesChanged
    this.onRuntimeEvent = onRuntimeEvent
  }

  setChangeListener(listener: GameServerChangeListener): void {
    this.onFilesChanged = listener
  }

  setRuntimeEventListener(listener: GameServerRuntimeEventListener): void {
    this.onRuntimeEvent = listener
  }

  async start(projectDir: string, options: GameServerStartOptions = {}): Promise<GameServerStartResult> {
    const absoluteProjectDir = resolve(projectDir)
    const projectId = basename(absoluteProjectDir)
    const existing = this.running.get(projectId)
    if (existing) return { port: existing.port }

    const projectRealPath = await realpath(absoluteProjectDir)
    const stats = await lstat(projectRealPath)
    if (!stats.isDirectory()) {
      throw new Error(`Game project path is not a directory: ${absoluteProjectDir}`)
    }

    const server = createServer((request, response) => {
      void this.handleRequest(projectId, projectRealPath, request, response)
    })

    try {
      const port = await this.listenOnFirstAvailablePort(server)
      const entry: RunningGameServer = {
        projectId,
        projectDir: absoluteProjectDir,
        projectRealPath,
        workspaceId: options.workspaceId,
        server,
        port,
      }
      entry.watcher = this.createWatcher(entry)
      this.running.set(projectId, entry)
      return { port }
    } catch (error) {
      server.close()
      throw error
    }
  }

  async stop(projectId: string): Promise<void> {
    const entry = this.running.get(projectId)
    if (!entry) return
    this.running.delete(projectId)
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.watcher?.close()
    await new Promise<void>((resolvePromise, rejectPromise) => {
      entry.server.close(error => {
        if (error) rejectPromise(error)
        else resolvePromise()
      })
    })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map(projectId => this.stop(projectId)))
  }

  getPort(projectId: string): number | null {
    return this.running.get(projectId)?.port ?? null
  }

  listRunning(): Array<{ projectId: string; projectDir: string; port: number }> {
    return [...this.running.values()].map(entry => ({
      projectId: entry.projectId,
      projectDir: entry.projectDir,
      port: entry.port,
    }))
  }

  private async handleRequest(projectId: string, projectRealPath: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isAllowedHostHeader(request.headers.host)) {
      sendPlain(response, 400, 'Bad Request')
      return
    }

    let url: URL
    try {
      url = new URL(request.url ?? '/', `http://${GAME_SERVER_HOST}`)
    } catch {
      sendPlain(response, 400, 'Bad Request')
      return
    }

    if (url.pathname === GAME_RUNTIME_EVENT_ENDPOINT) {
      await this.handleRuntimeEventRequest(projectId, request, response)
      return
    }

    const decodedPathname = decodeRequestPath(url.pathname)
    if (!decodedPathname || decodedPathname.includes('\0') || hasTraversal(decodedPathname)) {
      sendPlain(response, 403, 'Forbidden')
      return
    }

    const relativePath = decodedPathname === '/' ? 'index.html' : normalize(decodedPathname.replace(/^\/+/, ''))
    if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`) || isDeniedServePath(relativePath)) {
      sendPlain(response, 403, 'Forbidden')
      return
    }

    const candidatePath = resolve(projectRealPath, relativePath)
    let candidateRealPath: string
    let stats
    try {
      candidateRealPath = await realpath(candidatePath)
      stats = await lstat(candidateRealPath)
    } catch {
      sendPlain(response, 404, 'Not Found')
      return
    }

    if (!isPathInside(candidateRealPath, projectRealPath)) {
      sendPlain(response, 403, 'Forbidden')
      return
    }

    if (!stats.isFile()) {
      sendPlain(response, 404, 'Not Found')
      return
    }

    response.statusCode = 200
    response.setHeader('Content-Type', contentTypeForPath(candidateRealPath))
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:")
    if (extname(candidateRealPath).toLowerCase() === '.html') {
      const html = await readFile(candidateRealPath, 'utf-8')
      response.end(injectGameRuntimeBridge(html))
      return
    }
    createReadStream(candidateRealPath).pipe(response)
  }

  private async handleRuntimeEventRequest(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      sendPlain(response, 405, 'Method Not Allowed')
      return
    }

    try {
      const body = await readRequestBody(request, GAME_RUNTIME_EVENT_MAX_BYTES)
      const parsed = JSON.parse(body) as unknown
      const event = normalizeRuntimeEvent(projectId, parsed)
      if (event) this.onRuntimeEvent?.(event)
      response.statusCode = 204
      response.end()
    } catch {
      sendPlain(response, 400, 'Bad Request')
    }
  }

  private listenOnFirstAvailablePort(server: Server): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
      const tryPort = (port: number) => {
        if (port > GAME_SERVER_PORT_END) {
          rejectPromise(new Error(`No available game server ports in ${GAME_SERVER_PORT_START}-${GAME_SERVER_PORT_END}`))
          return
        }

        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening)
          if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
            tryPort(port + 1)
            return
          }
          rejectPromise(error)
        }
        const onListening = () => {
          server.off('error', onError)
          resolvePromise(port)
        }

        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, GAME_SERVER_HOST)
      }

      tryPort(GAME_SERVER_PORT_START)
    })
  }

  private createWatcher(entry: RunningGameServer): FSWatcher | undefined {
    try {
      return watch(entry.projectDir, { recursive: true }, (_eventType, fileName) => {
        const path = fileName ? String(fileName) : null
        if (isIgnoredWatchPath(path)) return
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = undefined
          this.onFilesChanged?.({
            workspaceId: entry.workspaceId,
            projectId: entry.projectId,
            kind: 'files',
          })
        }, GAME_SERVER_WATCH_DEBOUNCE_MS)
      })
    } catch {
      return undefined
    }
  }
}
