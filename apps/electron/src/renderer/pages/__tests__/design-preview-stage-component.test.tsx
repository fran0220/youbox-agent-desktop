import React from 'react'
import { beforeAll, describe, expect, it } from 'bun:test'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesignArtifactKind, DesignProjectMeta } from '@craft-agent/shared/protocol'
import { DESIGN_PROTOTYPE_DEVICE_WIDTHS } from '../../atoms/design'
import { DesignPreviewStage } from '../DesignStudioPage'

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {},
      interpolation: { escapeValue: false },
    })
  }
})

function project(kind: DesignArtifactKind, entryFile = 'index.html'): DesignProjectMeta {
  return {
    id: `project-${kind}`,
    name: `${kind} project`,
    kind,
    sessionId: null,
    designSystemId: null,
    templateId: null,
    entryFile,
    thumbnailPath: null,
    createdAt: 100,
    updatedAt: 200,
    version: 1,
  }
}

function renderPreview(kind: DesignArtifactKind, reloadToken = 0, entryFile?: string): string {
  return renderToStaticMarkup(
    <DesignPreviewStage
      workspaceId="workspace one"
      project={project(kind, entryFile)}
      reloadToken={reloadToken}
      onRefresh={() => {}}
    />,
  )
}

describe('DesignPreviewStage component rendering', () => {
  it('renders cache-busted design protocol iframe URLs for manual refresh reload tokens', () => {
    const first = renderPreview('prototype', 0, 'slides/index.html')
    const refreshed = renderPreview('prototype', 1, 'slides/index.html')

    expect(first).toContain('src="design://project/workspace%20one/project-prototype/slides/index.html?reload=0"')
    expect(refreshed).toContain('src="design://project/workspace%20one/project-prototype/slides/index.html?reload=1"')
    expect(first).toContain('design.preview.refresh')
  })

  it('renders prototype device-width controls and default desktop frame attributes', () => {
    const html = renderPreview('prototype')

    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="design.preview.deviceWidth"')
    expect(html).toContain('title="design.preview.device.desktop"')
    expect(html).toContain('title="design.preview.device.tablet"')
    expect(html).toContain('title="design.preview.device.mobile"')
    expect(html).toContain('data-design-preview-kind="prototype"')
    expect(html).toContain('data-design-preview-device="desktop"')
    expect(html).toContain(`data-design-preview-device-width="${DESIGN_PROTOTYPE_DEVICE_WIDTHS.desktop}"`)
    expect(html).toContain(`max-width:${DESIGN_PROTOTYPE_DEVICE_WIDTHS.desktop}px`)
  })

  it('renders deck previews in the 16:9 presentation branch', () => {
    const html = renderPreview('deck')

    expect(html).toContain('data-design-preview-kind="deck"')
    expect(html).toContain('aspect-ratio:16 / 9')
    expect(html).toContain('width:min(100%, calc((100vh - 11rem) * 16 / 9))')
    expect(html).not.toContain('data-design-preview-device=')
  })

  it('renders doc and image previews through the page-style branches', () => {
    const doc = renderPreview('doc')
    const image = renderPreview('image')

    expect(doc).toContain('data-design-preview-kind="doc"')
    expect(doc).toContain('max-width:900px')
    expect(image).toContain('data-design-preview-kind="image"')
    expect(image).toContain('max-width:960px')
  })

  it('renders a sandboxed iframe without top-navigation permissions', () => {
    const html = renderPreview('prototype')

    expect(html).toContain('sandbox="allow-scripts allow-same-origin"')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('allow-top-navigation-by-user-activation')
  })
})
