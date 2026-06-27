import { afterEach, describe, expect, it } from 'bun:test'
import {
  buildProductDeepLinkUrl,
  isProductDeepLinkProtocol,
  resolveDeeplinkScheme,
} from '../deeplink-scheme.ts'
import { DEFAULT_DEEPLINK_SCHEME } from '../product-identity.ts'

describe('resolveDeeplinkScheme', () => {
  const prev = process.env.CRAFT_DEEPLINK_SCHEME

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CRAFT_DEEPLINK_SCHEME
    } else {
      process.env.CRAFT_DEEPLINK_SCHEME = prev
    }
  })

  it('returns DEFAULT_DEEPLINK_SCHEME when CRAFT_DEEPLINK_SCHEME is unset', () => {
    delete process.env.CRAFT_DEEPLINK_SCHEME
    expect(resolveDeeplinkScheme()).toBe(DEFAULT_DEEPLINK_SCHEME)
  })

  it('honors CRAFT_DEEPLINK_SCHEME in Node/main (VAL-BRAND-018)', () => {
    process.env.CRAFT_DEEPLINK_SCHEME = 'probe'
    expect(resolveDeeplinkScheme()).toBe('probe')
  })
})

describe('buildProductDeepLinkUrl', () => {
  it('builds URLs with the resolved scheme', () => {
    delete process.env.CRAFT_DEEPLINK_SCHEME
    expect(buildProductDeepLinkUrl('allSessions')).toBe('origincoworks://allSessions')
    expect(buildProductDeepLinkUrl('/settings/shortcuts')).toBe('origincoworks://settings/shortcuts')
  })
})

describe('resolveDeeplinkScheme without process (renderer)', () => {
  it('does not throw and uses default scheme when process is undefined at call time', () => {
    const saved = globalThis.process
    try {
      // Simulate Electron renderer (contextIsolation, no Node process global)
      // @ts-expect-error — intentional removal for test
      delete globalThis.process

      expect(resolveDeeplinkScheme()).toBe(DEFAULT_DEEPLINK_SCHEME)
      expect(buildProductDeepLinkUrl('sources?window=focused')).toBe(
        'origincoworks://sources?window=focused',
      )
      expect(isProductDeepLinkProtocol('origincoworks:')).toBe(true)
    } finally {
      globalThis.process = saved
    }
  })
})

describe('isProductDeepLinkProtocol', () => {
  it('matches the effective scheme case-insensitively', () => {
    expect(isProductDeepLinkProtocol('origincoworks:')).toBe(true)
    expect(isProductDeepLinkProtocol('ORIGINCOWORKS:')).toBe(true)
    expect(isProductDeepLinkProtocol('craftagents:')).toBe(false)
  })
})
