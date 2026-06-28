import { describe, it, expect } from 'bun:test'
import { assertSameOriginForStateChangingRequest } from '../security'

describe('assertSameOriginForStateChangingRequest', () => {
  it('allows POST with matching Origin', () => {
    const req = new Request('http://127.0.0.1:9100/api/auth', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:9100' },
    })
    expect(assertSameOriginForStateChangingRequest(req)).toBeNull()
  })

  it('blocks POST with foreign Origin', async () => {
    const req = new Request('http://127.0.0.1:9100/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    })
    const res = assertSameOriginForStateChangingRequest(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Forbidden' })
  })

  it('allows GET without Origin check', () => {
    const req = new Request('http://127.0.0.1:9100/api/config', { method: 'GET' })
    expect(assertSameOriginForStateChangingRequest(req)).toBeNull()
  })
})
