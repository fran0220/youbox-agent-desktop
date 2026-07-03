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
        const status = result.status === 404 ? 404 : result.status
        const body = status === 404 ? missingArtifactHtml() : null
        return new Response(body, {
          status,
          headers: body ? {
            'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data: blob:",
            'Content-Type': 'text/html',
          } : undefined,
        })
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

function missingArtifactHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Artifact missing</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #f8fafc;
      }
      main {
        width: min(28rem, calc(100vw - 3rem));
        padding: 2rem;
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 1rem;
        background: white;
        text-align: center;
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.1);
      }
      h1 {
        margin: 0;
        font-size: 1.25rem;
      }
      p {
        margin: 0.75rem 0 0;
        color: #64748b;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Artifact not found</h1>
      <p>The entry file is missing. Restore it, then refresh the preview.</p>
    </main>
  </body>
</html>`
}
