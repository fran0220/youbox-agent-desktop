import { protocol } from 'electron'
import { readFile } from 'fs/promises'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { mainLog } from './logger'
import { resolveDesignRequest } from './design-protocol-resolver'

export function registerDesignScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'design',
      privileges: {
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

export function registerDesignHandler(): void {
  protocol.handle('design', async (request) => {
    try {
      const result = await resolveDesignRequest(
        (workspaceId) => getWorkspaceByNameOrId(workspaceId)?.rootPath,
        request.url,
      )

      if (result.status !== 200 || !result.filePath) {
        return new Response(null, { status: result.status })
      }

      const body = await readFile(result.filePath)
      return new Response(new Uint8Array(body), {
        status: result.status,
        headers: {
          ...result.headers,
          'Content-Type': result.contentType ?? 'application/octet-stream',
        },
      })
    } catch (error) {
      mainLog.error('Design protocol error:', error)
      return new Response(null, { status: 500 })
    }
  })

  mainLog.info('Registered design:// protocol handler')
}
