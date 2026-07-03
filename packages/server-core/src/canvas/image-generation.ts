/**
 * Server-side image generation for the canvas (canvas:generateImage).
 *
 * Resolves an OpenAI-compatible LLM connection at runtime (base URL + API key
 * come from the llm-connections config + credential manager — never hardcoded)
 * and calls its images endpoint. Text-to-image uses POST /images/generations;
 * when reference images are supplied it attempts POST /images/edits (multipart)
 * and degrades gracefully to text-to-image when the endpoint rejects edits.
 *
 * Secrets are never returned or logged — HTTP bodies and error text are redacted
 * before they leave this module.
 */

import { getLlmConnections, getDefaultLlmConnection, type LlmConnection } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { CanvasGenerateImageErrorCode } from '@craft-agent/shared/protocol'

/** Model used for canvas image generation when a connection lists no image model. */
export const CANVAS_IMAGE_MODEL = 'gpt-image-2'

/** Default image size requested when the caller omits one. */
export const CANVAS_DEFAULT_IMAGE_SIZE = '1024x1024'

const DEFAULT_TIMEOUT_MS = 60_000

export interface ResolvedImageConnection {
  slug: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface ImageReference {
  data: Buffer
  fileName: string
}

export interface GenerateImageParams {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  size?: string
  references?: ImageReference[]
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface GenerateImageOk {
  ok: true
  b64: string
  /** Which endpoint produced the image (edits => true image-to-image). */
  usedEndpoint: 'generations' | 'edits'
}

export interface GenerateImageErr {
  ok: false
  code: CanvasGenerateImageErrorCode
  message: string
}

export type GenerateImageOutcome = GenerateImageOk | GenerateImageErr

/** Redact bearer tokens / api-key-looking substrings from any string we surface. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9._\-]+/g, 'sk-[REDACTED]')
    .replace(/("?api[_-]?key"?\s*[:=]\s*")[^"]+(")/gi, '$1[REDACTED]$2')
}

function modelImageId(conn: LlmConnection): string | undefined {
  for (const m of conn.models ?? []) {
    const id = typeof m === 'string' ? m : m.id
    if (/image/i.test(id)) return id
  }
  return undefined
}

/**
 * Resolve an image-capable connection: an OpenAI-compatible endpoint (has a
 * baseUrl) with retrievable credentials. Connections that explicitly list an
 * image model are preferred, then the workspace/global default, then the rest.
 * Returns null when nothing usable is configured.
 */
export async function resolveImageConnection(): Promise<ResolvedImageConnection | null> {
  const connections = getLlmConnections()
  if (connections.length === 0) return null

  const defaultSlug = getDefaultLlmConnection()
  const ordered = [...connections].sort((a, b) => {
    const aImg = modelImageId(a) ? 1 : 0
    const bImg = modelImageId(b) ? 1 : 0
    if (aImg !== bImg) return bImg - aImg
    const aDef = a.slug === defaultSlug ? 1 : 0
    const bDef = b.slug === defaultSlug ? 1 : 0
    return bDef - aDef
  })

  const manager = getCredentialManager()
  for (const conn of ordered) {
    const baseUrl = conn.baseUrl?.trim()
    if (!baseUrl) continue
    let apiKey: string | null = null
    try {
      apiKey = await manager.getLlmApiKey(conn.slug)
    } catch {
      apiKey = null
    }
    if (!apiKey) continue
    return {
      slug: conn.slug,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      model: modelImageId(conn) ?? CANVAS_IMAGE_MODEL,
    }
  }
  return null
}

function errFromHttp(status: number, bodyText: string): GenerateImageErr {
  const code: CanvasGenerateImageErrorCode = status === 401 || status === 403 ? 'auth' : 'network'
  const snippet = redactSecrets(bodyText).slice(0, 300)
  return { ok: false, code, message: `image endpoint returned HTTP ${status}: ${snippet}` }
}

function extractB64(json: unknown): string | undefined {
  const data = (json as { data?: Array<{ b64_json?: string }> } | null)?.data
  const b64 = Array.isArray(data) ? data[0]?.b64_json : undefined
  return typeof b64 === 'string' && b64.length > 0 ? b64 : undefined
}

async function postGenerations(params: GenerateImageParams, doFetch: typeof fetch, signal: AbortSignal): Promise<GenerateImageOutcome> {
  const res = await doFetch(`${params.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size ?? CANVAS_DEFAULT_IMAGE_SIZE,
    }),
    signal,
  })
  if (!res.ok) return errFromHttp(res.status, await safeText(res))
  const b64 = extractB64(await safeJson(res))
  if (!b64) return { ok: false, code: 'invalid_response', message: 'image endpoint response missing data[0].b64_json' }
  return { ok: true, b64, usedEndpoint: 'generations' }
}

async function postEdits(params: GenerateImageParams, doFetch: typeof fetch, signal: AbortSignal): Promise<GenerateImageOutcome> {
  const form = new FormData()
  form.set('model', params.model)
  form.set('prompt', params.prompt)
  form.set('n', '1')
  form.set('size', params.size ?? CANVAS_DEFAULT_IMAGE_SIZE)
  for (const ref of params.references ?? []) {
    const bytes = Uint8Array.from(ref.data)
    form.append('image', new Blob([bytes], { type: 'image/png' }), ref.fileName)
  }
  const res = await doFetch(`${params.baseUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.apiKey}` },
    body: form,
    signal,
  })
  if (!res.ok) return errFromHttp(res.status, await safeText(res))
  const b64 = extractB64(await safeJson(res))
  if (!b64) return { ok: false, code: 'invalid_response', message: 'image edits response missing data[0].b64_json' }
  return { ok: true, b64, usedEndpoint: 'edits' }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try { return await res.text() } catch { return '' }
}

async function safeJson(res: { json(): Promise<unknown> }): Promise<unknown> {
  try { return await res.json() } catch { return null }
}

/**
 * Generate an image. When references are provided the edits (image-to-image)
 * endpoint is attempted first and falls back to plain generation if the
 * endpoint does not support edits.
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageOutcome> {
  const doFetch = params.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return { ok: false, code: 'network', message: 'fetch is not available in this runtime' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const hasRefs = (params.references?.length ?? 0) > 0
    if (hasRefs) {
      const edits = await postEdits(params, doFetch, controller.signal)
      if (edits.ok) return edits
      // Graceful degrade: fall back to text-to-image when edits is unsupported.
      const fallback = await postGenerations(params, doFetch, controller.signal)
      if (fallback.ok) return fallback
      return edits.code === 'auth' ? edits : fallback
    }
    return await postGenerations(params, doFetch, controller.signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, code: 'timeout', message: `image generation timed out after ${params.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 'network', message: redactSecrets(message) }
  } finally {
    clearTimeout(timeout)
  }
}
