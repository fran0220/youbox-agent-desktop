import {
  assertGatewayUser,
  assertLoginResponse,
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
}
