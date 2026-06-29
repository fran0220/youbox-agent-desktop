import { describe, expect, it } from 'bun:test'
import { getHostname } from '../utils'

const LABELS = { newTab: 'New Tab', localFile: 'Local File' }

describe('getHostname', () => {
  it('returns stripped hostname for https URLs', () => {
    expect(getHostname('https://www.example.com/path?q=1', LABELS)).toBe('example.com')
  })

  it('returns New Tab for about:blank', () => {
    expect(getHostname('about:blank', LABELS)).toBe('New Tab')
  })

  it('returns filename for file URLs', () => {
    expect(getHostname('file:///Users/tester/report.html', LABELS)).toBe('report.html')
  })

  it('returns Local File for file URLs without basename', () => {
    expect(getHostname('file:///Users/tester/folder/', LABELS)).toBe('Local File')
  })

  it('returns protocol token for custom schemes with empty hostname', () => {
    expect(getHostname('data:text/html,hello', LABELS)).toBe('data')
  })

  it('falls back to original input for malformed URLs', () => {
    expect(getHostname('not a url', LABELS)).toBe('not a url')
  })
})