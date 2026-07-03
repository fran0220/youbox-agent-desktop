import { stat, realpath } from 'fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'path'

export type WorkspaceRootResolver = (workspaceId: string) => string | null | undefined | Promise<string | null | undefined>

export interface DesignProtocolResolution {
  status: number
  filePath?: string
  contentType?: string
  headers?: Record<string, string>
}

const DESIGN_URL_PREFIX = 'design://project/'
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const HTML_CSP = "default-src 'self' 'unsafe-inline' data: blob:"

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mjs': 'application/javascript',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
}

export async function resolveDesignRequest(
  workspaceRootResolver: WorkspaceRootResolver,
  requestUrl: string,
): Promise<DesignProtocolResolution> {
  const parsed = parseDesignUrl(requestUrl)
  if (!parsed) return { status: 400 }

  const workspaceRoot = await workspaceRootResolver(parsed.workspaceId)
  if (!workspaceRoot) return { status: 404 }

  const projectDir = join(workspaceRoot, 'design', parsed.projectId)
  let projectRealPath: string
  try {
    projectRealPath = await realpath(projectDir)
  } catch {
    return { status: 404 }
  }

  const candidatePath = join(projectDir, ...parsed.relPathSegments)
  let candidateRealPath: string
  try {
    candidateRealPath = await realpath(candidatePath)
  } catch {
    return { status: 404 }
  }

  if (!isContainedBy(projectRealPath, candidateRealPath)) return { status: 404 }

  try {
    const candidateStat = await stat(candidateRealPath)
    if (!candidateStat.isFile()) return { status: 404 }
  } catch {
    return { status: 404 }
  }

  const contentType = getContentType(candidateRealPath)
  const headers: Record<string, string> = {}
  if (contentType === 'text/html') {
    headers['Content-Security-Policy'] = HTML_CSP
  }

  return {
    status: 200,
    filePath: candidateRealPath,
    contentType,
    headers,
  }
}

function parseDesignUrl(requestUrl: string): { workspaceId: string; projectId: string; relPathSegments: string[] } | null {
  if (!requestUrl.startsWith(DESIGN_URL_PREFIX)) return null

  const rawPath = stripQueryAndHash(requestUrl.slice(DESIGN_URL_PREFIX.length))
  const rawSegments = rawPath.split('/')
  if (rawSegments.length < 3) return null

  const workspaceId = decodeSegment(rawSegments[0])
  const projectId = decodeSegment(rawSegments[1])
  if (!workspaceId || !projectId || !isSafeIdSegment(workspaceId) || !PROJECT_ID_PATTERN.test(projectId)) return null

  const relPathSegments: string[] = []
  for (const rawSegment of rawSegments.slice(2)) {
    const segment = decodeSegment(rawSegment)
    if (!segment || !isSafeRelPathSegment(segment)) return null
    relPathSegments.push(segment)
  }

  return { workspaceId, projectId, relPathSegments }
}

function stripQueryAndHash(rawPath: string): string {
  const queryIdx = rawPath.indexOf('?')
  const hashIdx = rawPath.indexOf('#')
  const endIndexes = [queryIdx, hashIdx].filter((idx) => idx >= 0)
  return endIndexes.length === 0 ? rawPath : rawPath.slice(0, Math.min(...endIndexes))
}

function decodeSegment(rawSegment: string): string | null {
  let segment = rawSegment
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(segment)
      if (decoded === segment) return decoded
      segment = decoded
    } catch {
      return null
    }
  }
  return segment
}

function isSafeIdSegment(segment: string): boolean {
  return segment.length > 0 && !segment.includes('/') && !segment.includes('\\')
}

function isSafeRelPathSegment(segment: string): boolean {
  if (segment === '.' || segment === '..') return false
  if (segment.includes('/') || segment.includes('\\')) return false
  if (isAbsolute(segment) || /^[A-Za-z]:/.test(segment)) return false
  return true
}

function isContainedBy(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

function getContentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
