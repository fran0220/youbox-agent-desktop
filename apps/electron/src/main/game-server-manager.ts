import { createServer, type Server, type ServerResponse } from 'node:http'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, extname, normalize, resolve, sep } from 'node:path'

export const GAME_SERVER_HOST = '127.0.0.1'
export const GAME_SERVER_PORT_START = 3130
export const GAME_SERVER_PORT_END = 3169
export const GAME_SERVER_WATCH_DEBOUNCE_MS = 500

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

function isIgnoredWatchPath(fileName: string | null): boolean {
  if (!fileName) return true
  const normalized = fileName.replaceAll('\\', '/')
  if (normalized === 'project.json' || normalized.endsWith('/project.json')) return true
  if (normalized === 'thumbnail.png' || normalized.endsWith('/thumbnail.png')) return true
  return normalized === '.agents' || normalized.startsWith('.agents/') || normalized.includes('/.agents/')
}

export class GameServerManager {
  private readonly running = new Map<string, RunningGameServer>()
  private onFilesChanged?: GameServerChangeListener

  constructor(onFilesChanged?: GameServerChangeListener) {
    this.onFilesChanged = onFilesChanged
  }

  setChangeListener(listener: GameServerChangeListener): void {
    this.onFilesChanged = listener
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
      void this.handleRequest(projectRealPath, request.url ?? '/', response)
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

  private async handleRequest(projectRealPath: string, rawUrl: string, response: ServerResponse): Promise<void> {
    let url: URL
    try {
      url = new URL(rawUrl, `http://${GAME_SERVER_HOST}`)
    } catch {
      sendPlain(response, 400, 'Bad Request')
      return
    }

    const decodedPathname = decodeRequestPath(url.pathname)
    if (!decodedPathname || decodedPathname.includes('\0') || hasTraversal(decodedPathname)) {
      sendPlain(response, 403, 'Forbidden')
      return
    }

    const relativePath = decodedPathname === '/' ? 'index.html' : normalize(decodedPathname.replace(/^\/+/, ''))
    if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`)) {
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
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    createReadStream(candidateRealPath).pipe(response)
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
