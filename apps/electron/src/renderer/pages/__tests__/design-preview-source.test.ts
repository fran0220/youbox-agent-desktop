import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const DESIGN_PAGE_PATH = join(import.meta.dir, '..', 'DesignStudioPage.tsx')
const RENDERER_INDEX_PATH = join(import.meta.dir, '..', '..', 'index.html')

describe('design preview stage source wiring', () => {
  it('embeds the artifact in a sandboxed design protocol iframe', () => {
    const src = readFileSync(DESIGN_PAGE_PATH, 'utf8')

    expect(src).toContain('buildDesignPreviewUrl(')
    expect(src).toContain('sandbox="allow-scripts allow-same-origin"')
    expect(src).not.toContain('allow-top-navigation')
  })

  it('keeps manual refresh and kind-specific stage controls wired', () => {
    const src = readFileSync(DESIGN_PAGE_PATH, 'utf8')

    expect(src).toContain("t('design.preview.refresh')")
    expect(src).toContain('createDesignPreviewRefreshScheduler')
    expect(src).toContain('onProjectFileWrite={previewRefreshScheduler.schedule}')
    expect(src).toContain("project.kind === 'deck'")
    expect(src).toContain("project.kind === 'prototype'")
    expect(src).toContain('DESIGN_PROTOTYPE_DEVICE_WIDTHS')
  })

  it('keeps one-click blank creation while preserving the richer picker', () => {
    const src = readFileSync(DESIGN_PAGE_PATH, 'utf8')

    expect(src).toContain('buildBlankDesignProjectCreateInput')
    expect(src).toContain("t('design.gallery.createBlank')")
    expect(src).toContain("t('design.gallery.create')")
    expect(src).toContain("t('design.createFirst.button')")
    expect(src).toContain("t('design.createFirst.chooseStarter')")
    expect(src).toContain('setCreateFlowOpen(true)')
  })

  it('allows design protocol frames through the renderer CSP', () => {
    const src = readFileSync(RENDERER_INDEX_PATH, 'utf8')

    expect(src).toContain("frame-src 'self' design:")
  })
})
