import { afterEach, describe, expect, it } from 'bun:test'
import {
  buildProductDeepLinkUrl,
  isProductDeepLinkProtocol,
  isProductDeepLinkUrl,
  resolveDeeplinkScheme,
} from '../deeplink-scheme.ts'
import { DEFAULT_DEEPLINK_SCHEME, LEGACY_DEEPLINK_SCHEME } from '../product-identity.ts'

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
    expect(buildProductDeepLinkUrl('allSessions')).toBe('originai://allSessions')
    expect(buildProductDeepLinkUrl('/settings/shortcuts')).toBe('originai://settings/shortcuts')
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
        'originai://sources?window=focused',
      )
      expect(isProductDeepLinkProtocol('originai:')).toBe(true)
    } finally {
      globalThis.process = saved
    }
  })
})

describe('isProductDeepLinkProtocol', () => {
  it('matches the effective scheme and legacy alias case-insensitively', () => {
    expect(isProductDeepLinkProtocol('originai:')).toBe(true)
    expect(isProductDeepLinkProtocol('ORIGINAI:')).toBe(true)
    expect(isProductDeepLinkProtocol(`${LEGACY_DEEPLINK_SCHEME}:`)).toBe(true)
    expect(isProductDeepLinkProtocol('ORIGINCOWORKS:')).toBe(true)
    expect(isProductDeepLinkProtocol('craftagents:')).toBe(false)
  })
})

describe('isProductDeepLinkUrl', () => {
  it('accepts current and legacy scheme URLs', () => {
    expect(isProductDeepLinkUrl('originai://settings')).toBe(true)
    expect(isProductDeepLinkUrl('origincoworks://settings')).toBe(true)
    expect(isProductDeepLinkUrl('craftagents://settings')).toBe(false)
  })
})