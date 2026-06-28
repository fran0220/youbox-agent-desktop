import { describe, it, expect } from 'bun:test'
import { CLI_DESCRIPTION, CLI_PROGRAM_NAME } from './branding.ts'

describe('cli branding', () => {
  it('uses OriginCoworks program identity', () => {
    expect(CLI_PROGRAM_NAME).toBe('ocn')
    expect(CLI_DESCRIPTION).toContain('OriginCoworks')
    expect(CLI_DESCRIPTION).not.toContain('Craft Agent server')
  })
})
