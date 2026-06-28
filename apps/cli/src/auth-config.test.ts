import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import {
  loginAndPersistCliConfig,
  readCliAuthConfig,
  writeCliAuthConfig,
  defaultCliConfigPath,
} from './auth-config.ts'

const VALID_TOKEN = 'a'.repeat(64)

describe('cli auth-config', () => {
  let configPath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ocn-cli-auth-'))
    configPath = join(dir, 'cli.json')
  })

  afterEach(() => {
    GatewayClient.setFetchForTests(undefined)
  })

  it('writeCliAuthConfig persists 64-hex token', async () => {
    await writeCliAuthConfig(
      { gatewayUrl: 'http://127.0.0.1:8847', token: VALID_TOKEN },
      configPath,
    )
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as { token: string }
    expect(parsed.token).toBe(VALID_TOKEN)
    expect(await readCliAuthConfig(configPath)).toMatchObject({ token: VALID_TOKEN })
  })

  it('loginAndPersistCliConfig rejects bad credentials without writing token', async () => {
    GatewayClient.setFetchForTests(async (input, init) => {
      if (String(input).endsWith('/api/auth/login') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401 })
      }
      return new Response('not found', { status: 404 })
    })

    const result = await loginAndPersistCliConfig({
      username: 'octest',
      password: 'wrong',
      configPath,
    })
    expect(result.success).toBe(false)
    expect(await readCliAuthConfig(configPath)).toBeNull()
  })

  it('loginAndPersistCliConfig succeeds and writes cli.json', async () => {
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            token: VALID_TOKEN,
            user: { id: 'u1', name: 'octest', email: 'octest@local.test', role: 'admin' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })

    const result = await loginAndPersistCliConfig({
      username: 'octest',
      password: 'OcTest1234!',
      gatewayUrl: 'http://127.0.0.1:8847',
      serverUrl: 'ws://127.0.0.1:9101',
      configPath,
    })
    expect(result.success).toBe(true)
    const stored = await readCliAuthConfig(configPath)
    expect(stored?.token).toBe(VALID_TOKEN)
    expect(stored?.serverUrl).toBe('ws://127.0.0.1:9101')
  })

  it('defaultCliConfigPath uses CRAFT_CONFIG_DIR when set', () => {
    const prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = '/tmp/ocn-override'
    try {
      expect(defaultCliConfigPath()).toBe('/tmp/ocn-override/cli.json')
    } finally {
      if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = prev
    }
  })
})
