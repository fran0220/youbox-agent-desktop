import { createHash } from 'crypto';

/** SHA-256 first 8 bytes as hex (16 chars), matching gateway store.ContentChecksum */
export function contentChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}
