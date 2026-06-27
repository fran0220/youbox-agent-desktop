/**
 * Resolve method/body/headers from fetch(input, init), including Request inputs.
 */
export async function resolveRequestContext(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<{ bodyStr?: string; normalizedInit: RequestInit }> {
  // Prefer explicit init body (already detached from Request stream)
  if (typeof init?.body === 'string') {
    return { bodyStr: init.body, normalizedInit: init };
  }

  // OpenAI SDK / undici may pass a JSON-serialized body as Uint8Array or Buffer
  if (init?.body != null) {
    const raw = init.body;
    if (raw instanceof Uint8Array) {
      const bodyStr = new TextDecoder().decode(raw);
      return { bodyStr, normalizedInit: { ...init, body: bodyStr } };
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
      const bodyStr = raw.toString('utf8');
      return { bodyStr, normalizedInit: { ...init, body: bodyStr } };
    }
  }

  // Fallback: parse Request body when caller used fetch(new Request(...))
  if (input instanceof Request) {
    try {
      const bodyStr = await input.clone().text();
      const normalizedInit: RequestInit = {
        method: init?.method ?? input.method,
        headers: init?.headers ?? input.headers,
        body: init?.body ?? bodyStr,
      };
      return { bodyStr, normalizedInit };
    } catch {
      // Ignore body read errors — interception will be skipped
    }
  }

  return { bodyStr: undefined, normalizedInit: init ?? {} };
}
