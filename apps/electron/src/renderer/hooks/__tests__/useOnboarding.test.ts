import { describe, it, expect } from 'bun:test'
import {
  resolveSlugForMethod,
  apiSetupMethodToConnectionSetup,
  BASE_SLUG_FOR_METHOD,
} from '../useOnboarding'
import type { ApiSetupMethod } from '@/components/onboarding'

// ============================================================
// resolveSlugForMethod
// ============================================================

describe('resolveSlugForMethod', () => {
  it('maps every legacy setup method to the managed YouBox Gateway slug', () => {
    const methods: ApiSetupMethod[] = [
      'youbox_gateway', 'anthropic_api_key', 'claude_oauth',
      'pi_chatgpt_oauth', 'pi_copilot_oauth', 'pi_api_key',
    ]
    for (const method of methods) {
      const slug = resolveSlugForMethod(method, null, new Set())
      expect(slug).toBe('youbox-gateway')
      expect(BASE_SLUG_FOR_METHOD[method]).toBe('youbox-gateway')
    }
  })

  it('does not create user/provider-specific slugs when the managed slug exists', () => {
    const slug = resolveSlugForMethod(
      'anthropic_api_key',
      null,
      new Set(['youbox-gateway', 'youbox-gateway-2']),
    )
    expect(slug).toBe('youbox-gateway')
  })

  it('does not preserve legacy editing slugs', () => {
    const slug = resolveSlugForMethod('pi_chatgpt_oauth', 'chatgpt-plus', new Set(['chatgpt-plus']))
    expect(slug).toBe('youbox-gateway')
  })
})

// ============================================================
// apiSetupMethodToConnectionSetup
// ============================================================

describe('apiSetupMethodToConnectionSetup', () => {
  it('returns only the managed YouBox slug even when legacy credential options are provided', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'anthropic_api_key',
      { credential: 'sk-ant-test', baseUrl: 'https://custom.api', connectionDefaultModel: 'claude-sonnet-4-6', models: ['model-a'] },
      null,
      new Set(),
    )
    expect(setup).toEqual({ slug: 'youbox-gateway' })
    expect(setup.credential).toBeUndefined()
    expect(setup.baseUrl).toBeUndefined()
    expect(setup.defaultModel).toBeUndefined()
    expect(setup.models).toBeUndefined()
  })

  it('ignores legacy editing slugs and slug collisions', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'claude_oauth',
      { credential: 'oauth-token-123' },
      'claude-max',
      new Set(['youbox-gateway', 'claude-max']),
    )
    expect(setup).toEqual({ slug: 'youbox-gateway' })
  })

  it('keeps all legacy provider methods inert', () => {
    const methods: ApiSetupMethod[] = [
      'anthropic_api_key', 'claude_oauth',
      'pi_chatgpt_oauth', 'pi_copilot_oauth', 'pi_api_key',
    ]
    for (const method of methods) {
      const setup = apiSetupMethodToConnectionSetup(method, {}, null, new Set())
      expect(setup).toEqual({ slug: 'youbox-gateway' })
    }
  })
})
