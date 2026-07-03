import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import {
  GAME_SERVER_HOST,
  GAME_SERVER_PORT_START,
  GameServerManager,
} from '../game-server-manager'

let tmpRoot: string
let manager: GameServerManager

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'game-server-manager-test-'))
  manager = new GameServerManager()
})

afterEach(async () => {
  await manager.stopAll()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeProject(id: string): string {
  const projectDir = join(tmpRoot, id)
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  mkdirSync(join(projectDir, 'vendor'), { recursive: true })
  writeFileSync(join(projectDir, 'index.html'), '<!doctype html><h1>game ok</h1>')
  writeFileSync(join(projectDir, 'src', 'main.mjs'), 'export const ok = true')
  writeFileSync(join(projectDir, 'src', 'style.css'), 'body{color:red}')
  writeFileSync(join(projectDir, 'vendor', 'three.module.js'), 'export const three = true')
  writeFileSync(join(projectDir, 'data.json'), '{"ok":true}')
  writeFileSync(join(projectDir, 'asset.wasm'), 'wasm')
  writeFileSync(join(projectDir, 'image.png'), 'png')
  writeFileSync(join(projectDir, 'image.jpg'), 'jpg')
  writeFileSync(join(projectDir, 'model.glb'), 'glb')
  writeFileSync(join(projectDir, 'scene.gltf'), '{}')
  return projectDir
}

function rawGet(port: number, path: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({ hostname: GAME_SERVER_HOST, port, path, method: 'GET' }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        })
      })
    })
    req.on('error', rejectPromise)
    req.end()
  })
}

function listen(port: number): Promise<Server> {
  const server = createServer((_req, res) => res.end('busy'))
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, GAME_SERVER_HOST, () => resolvePromise(server))
  })
}

function close(server: Server): Promise<void> {
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

describe('GameServerManager', () => {
  it('probes ports sequentially and releases them on stop', async () => {
    const blocker = await listen(GAME_SERVER_PORT_START)
    try {
      const projectDir = makeProject('project-ports')
      const result = await manager.start(projectDir)
      expect(result.port).toBe(GAME_SERVER_PORT_START + 1)

      await manager.stop('project-ports')
      await expect(rawGet(result.port, '/index.html')).rejects.toThrow()
    } finally {
      await close(blocker)
    }
  })

  it('rejects traversal, encoded traversal, symlink escapes, and directory listings', async () => {
    const projectDir = makeProject('project-paths')
    const outside = join(tmpRoot, 'outside-secret.txt')
    writeFileSync(outside, 'do-not-leak')
    symlinkSync(outside, join(projectDir, 'src', 'escape.txt'))

    const { port } = await manager.start(projectDir)
    const control = await rawGet(port, '/index.html')
    expect(control.status).toBe(200)
    expect(control.body).toContain('game ok')

    const cases = [
      '/../../../../etc/hosts',
      '/%2e%2e%2f%2e%2e%2fetc/hosts',
      '/src/%2e%2e/%2e%2e/outside-secret.txt',
      '/src/escape.txt',
      '/missing.txt',
      '/src/',
    ]

    for (const path of cases) {
      const response = await rawGet(port, path)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(response.body).not.toContain('do-not-leak')
      expect(response.body).not.toContain('<html><body><ul>')
    }
  })

  it('serves required MIME types with JavaScript as text/javascript', async () => {
    const projectDir = makeProject('project-mime')
    const { port } = await manager.start(projectDir)

    const expectations: Array<[string, string]> = [
      ['/index.html', 'text/html'],
      ['/vendor/three.module.js', 'text/javascript'],
      ['/src/main.mjs', 'text/javascript'],
      ['/src/style.css', 'text/css'],
      ['/data.json', 'application/json'],
      ['/asset.wasm', 'application/wasm'],
      ['/image.png', 'image/png'],
      ['/image.jpg', 'image/jpeg'],
      ['/model.glb', 'model/gltf-binary'],
      ['/scene.gltf', 'model/gltf+json'],
    ]

    for (const [path, expectedContentType] of expectations) {
      const response = await rawGet(port, path)
      expect(response.status).toBe(200)
      expect(String(response.headers['content-type'])).toStartWith(expectedContentType)
    }
  })

  it('debounces file changes and ignores metadata paths', async () => {
    const events: Array<{ projectId: string; workspaceId?: string; kind: 'files' }> = []
    manager = new GameServerManager(event => events.push(event))
    const projectDir = makeProject('project-watch')
    mkdirSync(join(projectDir, '.agents'), { recursive: true })
    await manager.start(projectDir, { workspaceId: 'workspace-1' })

    writeFileSync(join(projectDir, 'project.json'), '{}')
    writeFileSync(join(projectDir, 'thumbnail.png'), 'thumb')
    writeFileSync(join(projectDir, '.agents', 'ignored.txt'), 'ignored')
    await Bun.sleep(700)
    expect(events).toHaveLength(0)

    writeFileSync(join(projectDir, 'src', 'a.js'), '1')
    writeFileSync(join(projectDir, 'src', 'b.js'), '2')
    writeFileSync(join(projectDir, 'src', 'c.js'), '3')
    await Bun.sleep(750)

    expect(events).toEqual([{ workspaceId: 'workspace-1', projectId: 'project-watch', kind: 'files' }])
  })

  it('stopAll releases every running server', async () => {
    const first = await manager.start(makeProject('project-a'))
    const second = await manager.start(makeProject('project-b'))
    expect(second.port).toBe(first.port + 1)

    await manager.stopAll()

    await expect(rawGet(first.port, '/index.html')).rejects.toThrow()
    await expect(rawGet(second.port, '/index.html')).rejects.toThrow()
  })
})
