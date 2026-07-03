import { describe, test, expect } from 'bun:test'
import {
  CHANNEL_TIMEOUT_OVERRIDES_MS,
  RPC_CHANNELS,
  resolveRequestTimeoutMs,
} from '../channels'
import { REQUEST_TIMEOUT_MS } from '../types'

describe('resolveRequestTimeoutMs', () => {
  test('returns the default for channels without an override', () => {
    expect(resolveRequestTimeoutMs(RPC_CHANNELS.sessions.GET)).toBe(REQUEST_TIMEOUT_MS)
  })

  test('returns the override for canvas:generateImage', () => {
    expect(resolveRequestTimeoutMs(RPC_CHANNELS.canvas.GENERATE_IMAGE)).toBe(180_000)
  })

  test('honors an explicit default argument for non-overridden channels', () => {
    expect(resolveRequestTimeoutMs(RPC_CHANNELS.sessions.GET, 12_345)).toBe(12_345)
  })

  test('override wins over an explicit default argument', () => {
    expect(resolveRequestTimeoutMs(RPC_CHANNELS.canvas.GENERATE_IMAGE, 12_345)).toBe(180_000)
  })

  test('falls back to the default for unknown channel names', () => {
    expect(resolveRequestTimeoutMs('does:not-exist')).toBe(REQUEST_TIMEOUT_MS)
    expect(resolveRequestTimeoutMs('does:not-exist', 99)).toBe(99)
  })

  test('canvas:generateImage override exceeds the default timeout', () => {
    expect(CHANNEL_TIMEOUT_OVERRIDES_MS[RPC_CHANNELS.canvas.GENERATE_IMAGE]).toBeGreaterThan(
      REQUEST_TIMEOUT_MS,
    )
  })

  test('only long-running channels carry an override', () => {
    expect(Object.keys(CHANNEL_TIMEOUT_OVERRIDES_MS)).toEqual([
      RPC_CHANNELS.canvas.GENERATE_IMAGE,
    ])
  })
})
