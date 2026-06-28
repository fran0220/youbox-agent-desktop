import { describe, expect, it } from 'bun:test'
import { resolveWebSocketUrl } from '../http-server'

describe('resolveWebSocketUrl', () => {
  it('derives host from request Host header and replaces port', () => {
    const req = new Request('http://localhost:9100/api/config', {
      headers: { Host: 'localhost:9100' },
    })
    expect(
      resolveWebSocketUrl(req, { wsProtocol: 'ws', wsPort: 9103 }),
    ).toBe('ws://localhost:9103')
  })

  it('preserves 127.0.0.1 when that is the request host', () => {
    const req = new Request('http://127.0.0.1:9100/api/config', {
      headers: { Host: '127.0.0.1:9100' },
    })
    expect(
      resolveWebSocketUrl(req, { wsProtocol: 'ws', wsPort: 9104 }),
    ).toBe('ws://127.0.0.1:9104')
  })

  it('returns publicWsUrl when configured', () => {
    const req = new Request('http://localhost:9100/api/config')
    expect(
      resolveWebSocketUrl(req, {
        publicWsUrl: 'wss://example.com/ws',
        wsProtocol: 'ws',
        wsPort: 9100,
      }),
    ).toBe('wss://example.com/ws')
  })
})
