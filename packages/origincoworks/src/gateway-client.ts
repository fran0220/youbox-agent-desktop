import {
  assertGatewaySkillPullResponse,
  assertGatewaySkillsChecksumResponse,
  assertGatewayUser,
  assertLoginResponse,
  type GatewaySkillFile,
  type GatewaySkillsChecksumResponse,
  type GatewayUser,
  type LoginResponse,
} from './types.ts';

export class GatewayHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'GatewayHttpError';
    this.status = status;
    this.body = body;
  }
}

export type GatewayFetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

let fetchOverride: GatewayFetchFn | undefined;

export class GatewayClient {
  private readonly baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  /** Test hook: replace global fetch for unit tests */
  static setFetchForTests(fn: GatewayFetchFn | undefined): void {
    fetchOverride = fn;
  }

  getToken(): string | undefined {
    return this.token;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  private resolveFetch(): GatewayFetchFn {
    return fetchOverride ?? ((input, init) => fetch(input, init));
  }

  private url(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit & { auth?: boolean } = {},
  ): Promise<unknown> {
    const { auth = false, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (auth) {
      if (!this.token) {
        throw new Error('gateway client has no bearer token; call login() first');
      }
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    if (rest.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await this.resolveFetch()(this.url(path), { ...rest, headers });
    const body = await this.readJson(res);
    if (!res.ok) {
      const errMsg =
        body && typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `gateway request failed: ${res.status}`;
      throw new GatewayHttpError(errMsg, res.status, body);
    }
    return body;
  }

  /** GET /health — plain text `ok` */
  async health(): Promise<boolean> {
    const res = await this.resolveFetch()(this.url('/health'));
    const text = await res.text();
    if (!res.ok) {
      throw new GatewayHttpError(`health check failed: ${res.status}`, res.status, text);
    }
    if (text !== 'ok') {
      throw new Error(`unexpected health body: ${JSON.stringify(text)}`);
    }
    return true;
  }

  /** POST /api/auth/login */
  async login(username: string, password: string): Promise<LoginResponse> {
    const body = await this.requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    assertLoginResponse(body);
    this.token = body.token;
    return body;
  }

  /** GET /api/users/me */
  async me(): Promise<GatewayUser> {
    const body = await this.requestJson('/api/users/me', { method: 'GET', auth: true });
    assertGatewayUser(body);
    return body;
  }

  /** GET /api/desktop/config — LLM runtime config for the desktop client */
  async desktopConfig(): Promise<unknown> {
    return this.requestJson('/api/desktop/config', { method: 'GET', auth: true });
  }

  /** GET /api/desktop/policy — role, trust, and capability flags for pre-tool-use gating */
  async desktopPolicy(workspaceSlug?: string): Promise<unknown> {
    const slug = workspaceSlug?.trim();
    const path =
      slug && slug.length > 0
        ? `/api/desktop/policy?workspace_slug=${encodeURIComponent(slug)}`
        : '/api/desktop/policy';
    return this.requestJson(path, { method: 'GET', auth: true });
  }

  /** POST /api/desktop/audit — persist a client-originated audit row (204) */
  async postDesktopAudit(body: {
    action: string;
    resource_type: string;
    resource_id: string;
  }): Promise<void> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (!this.token) {
      throw new Error('gateway client has no bearer token; call login() first');
    }
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await this.resolveFetch()(this.url('/api/desktop/audit'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 204) {
      return;
    }
    const responseBody = await this.readJson(res);
    if (!res.ok) {
      const errMsg =
        responseBody && typeof responseBody === 'object' && responseBody !== null && 'error' in responseBody
          ? String((responseBody as { error: unknown }).error)
          : `gateway request failed: ${res.status}`;
      throw new GatewayHttpError(errMsg, res.status, responseBody);
    }
  }

  /** GET /api/skills/checksum — aggregate checksums per owner bucket */
  async getSkillsChecksum(): Promise<GatewaySkillsChecksumResponse> {
    const body = await this.requestJson('/api/skills/checksum', { method: 'GET', auth: true });
    assertGatewaySkillsChecksumResponse(body);
    return body;
  }

  /**
   * GET /api/skills/pull?owner=system|user
   * Supports If-None-Match for system (and user) aggregate checksum.
   */
  async pullSkills(
    owner: string,
    ifNoneMatch?: string,
  ): Promise<{ status: 200 | 304; checksum: string; files: GatewaySkillFile[] }> {
    if (!this.token) {
      throw new Error('gateway client has no bearer token; call login() first');
    }
    const params = new URLSearchParams();
    params.set('owner', owner === 'system' ? 'system' : 'user');
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${this.token}`);
    if (ifNoneMatch) {
      headers.set('If-None-Match', ifNoneMatch);
    }
    const res = await this.resolveFetch()(this.url(`/api/skills/pull?${params.toString()}`), {
      method: 'GET',
      headers,
    });
    if (res.status === 304) {
      const etag = res.headers.get('ETag') ?? ifNoneMatch ?? '';
      return { status: 304, checksum: etag, files: [] };
    }
    const body = await this.readJson(res);
    if (!res.ok) {
      const errMsg =
        body && typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `gateway request failed: ${res.status}`;
      throw new GatewayHttpError(errMsg, res.status, body);
    }
    const parsed = assertGatewaySkillPullResponse(body);
    const etag = res.headers.get('ETag') ?? parsed.checksum;
    return { status: 200, checksum: etag, files: parsed.files };
  }

  /** POST /api/auth/logout — invalidates server session (204) */
  async logout(): Promise<void> {
    if (!this.token) {
      return;
    }
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await this.resolveFetch()(this.url('/api/auth/logout'), {
      method: 'POST',
      headers,
    });
    if (res.status === 204 || res.ok) {
      return;
    }
    const body = await this.readJson(res);
    const errMsg =
      body && typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `gateway logout failed: ${res.status}`;
    throw new GatewayHttpError(errMsg, res.status, body);
  }
}
