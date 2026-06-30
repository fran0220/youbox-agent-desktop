/**
 * CLI gateway login persistence (~/.originai/cli.json).
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { GatewayClient, GatewayHttpError } from '@craft-agent/origincoworks/gateway-client'
import { resolveGatewayBaseUrl, sanitizeGatewayLoginError } from '@craft-agent/origincoworks/auth'
import { DEFAULT_DATA_DIR_NAME } from '@craft-agent/shared/config/path-display'

const TOKEN_HEX = /^[0-9a-f]{64}$/i

export interface CliAuthConfig {
  gatewayUrl: string
  token: string
  /** WebSocket URL for headless RPC (optional until first remote command). */
  serverUrl?: string
  user?: { id: string; name: string; email?: string; role?: string }
}

export function defaultCliConfigPath(): string {
  const base = process.env.CRAFT_CONFIG_DIR?.trim() || join(homedir(), DEFAULT_DATA_DIR_NAME)
  return join(base, 'cli.json')
}

export async function readCliAuthConfig(path = defaultCliConfigPath()): Promise<CliAuthConfig | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CliAuthConfig>
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
    if (!TOKEN_HEX.test(token)) {
      return null
    }
    const gatewayUrl = (typeof parsed.gatewayUrl === 'string' ? parsed.gatewayUrl : resolveGatewayBaseUrl())
      .replace(/\/+$/, '')
    const serverUrl = typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()
      ? parsed.serverUrl.trim()
      : undefined
    return {
      gatewayUrl,
      token,
      serverUrl,
      user: parsed.user,
    }
  } catch {
    return null
  }
}

export async function writeCliAuthConfig(
  config: CliAuthConfig,
  path = defaultCliConfigPath(),
): Promise<void> {
  if (!TOKEN_HEX.test(config.token)) {
    throw new Error('gateway session token must be 64 hex characters')
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const payload: CliAuthConfig = {
    gatewayUrl: config.gatewayUrl.replace(/\/+$/, ''),
    token: config.token,
    ...(config.serverUrl ? { serverUrl: config.serverUrl } : {}),
    ...(config.user ? { user: config.user } : {}),
  }
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  try {
    await chmod(path, 0o600)
  } catch {
    // best effort on platforms that support it
  }
}

export async function clearCliAuthConfig(path = defaultCliConfigPath()): Promise<void> {
  try {
    await writeFile(path, '{}\n', { mode: 0o600 })
  } catch {
    // ignore missing file
  }
}

export type CliLoginResult =
  | { success: true; user: { id: string; name: string; email?: string; role?: string } }
  | { success: false; error: string }

export async function loginAndPersistCliConfig(opts: {
  username: string
  password: string
  gatewayUrl?: string
  serverUrl?: string
  configPath?: string
}): Promise<CliLoginResult> {
  const gatewayUrl = (opts.gatewayUrl?.trim() || resolveGatewayBaseUrl()).replace(/\/+$/, '')
  const username = opts.username.trim()
  const password = opts.password
  if (!username || !password) {
    return { success: false, error: 'Username and password are required.' }
  }

  const client = new GatewayClient(gatewayUrl)
  try {
    const { token, user } = await client.login(username, password)
    if (!TOKEN_HEX.test(token)) {
      return { success: false, error: 'Gateway returned an invalid session token.' }
    }
    await writeCliAuthConfig(
      {
        gatewayUrl,
        token,
        serverUrl: opts.serverUrl?.trim() || undefined,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      opts.configPath,
    )
    return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }
  } catch (err) {
    if (err instanceof GatewayHttpError && err.status === 401) {
      return { success: false, error: 'invalid credentials' }
    }
    return { success: false, error: sanitizeGatewayLoginError(err) }
  }
}

export async function persistValidatedGatewayToken(opts: {
  token: string
  gatewayUrl?: string
  serverUrl?: string
  configPath?: string
}): Promise<CliLoginResult> {
  const token = opts.token.trim()
  if (!TOKEN_HEX.test(token)) {
    return { success: false, error: 'Gateway token must be a 64-character hex string.' }
  }
  const gatewayUrl = (opts.gatewayUrl?.trim() || resolveGatewayBaseUrl()).replace(/\/+$/, '')
  const client = new GatewayClient(gatewayUrl, token)
  try {
    const user = await client.me()
    await writeCliAuthConfig(
      {
        gatewayUrl,
        token,
        serverUrl: opts.serverUrl?.trim() || undefined,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      opts.configPath,
    )
    return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }
  } catch (err) {
    if (err instanceof GatewayHttpError && (err.status === 401 || err.status === 403)) {
      return { success: false, error: 'invalid credentials' }
    }
    return { success: false, error: sanitizeGatewayLoginError(err) }
  }
}

export async function validateCliStoredToken(
  config: CliAuthConfig,
): Promise<{ ok: true; user: { id: string; name: string } } | { ok: false }> {
  const client = new GatewayClient(config.gatewayUrl, config.token)
  try {
    const user = await client.me()
    return { ok: true, user: { id: user.id, name: user.name } }
  } catch (err) {
    if (err instanceof GatewayHttpError && (err.status === 401 || err.status === 403)) {
      return { ok: false }
    }
    throw err
  }
}
