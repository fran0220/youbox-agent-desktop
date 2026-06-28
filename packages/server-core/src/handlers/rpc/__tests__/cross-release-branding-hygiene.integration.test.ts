/**
 * VAL-CROSS-018, VAL-CROSS-023, VAL-CROSS-024 — release feed, unified branding, secret hygiene.
 * Requires gateway on 8847 and local DB 5433.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetchDesktopConfig } from '@craft-agent/origincoworks/desktop-config';
import {
  applyGatewayLlmConfigFromSession,
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
} from '@craft-agent/origincoworks/llm-config';
import {
  getStoredGatewayToken,
  loginGateway,
  logoutGateway,
} from '@craft-agent/origincoworks/auth';
import { postAuditEvent } from '@craft-agent/origincoworks/audit';
import {
  resolveGatewayReleaseLatestUrl,
  resolveGatewayUpdaterFeedBaseUrl,
} from '@craft-agent/origincoworks/release';
import { PRODUCT_NAME } from '@craft-agent/shared/product-identity';
import { loadStoredConfig } from '@craft-agent/shared/config';

const GATEWAY = process.env.ORIGINCOWORKS_GATEWAY_URL ?? 'http://127.0.0.1:8847';
const USER = 'octest';
const PASS = 'OcTest1234!';
const PSQL =
  'PGPASSWORD=jaco psql -h localhost -p 5433 -U jaco -d jacoworks -tAc';

const NON_LLM_SETTING_KEYS = [
  'openai_api_key',
  'exa_api_key',
  'tavily_api_key',
  'fal_api_key',
  'mineru_token',
  'jimeng_api_key',
  'asset_gateway_token',
  'ai_search_token',
] as const;

const CROSS_RELEASE_VERSION = '99.88.77-cross-val';
const CROSS_RELEASE_ID = 'cross-val-018-release';

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${GATEWAY}/health`);
    return r.ok && (await r.text()) === 'ok';
  } catch {
    return false;
  }
}

function psql(sql: string): string {
  return execSync(`${PSQL} ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

function repoRoot(): string {
  return join(import.meta.dir, '..', '..', '..', '..', '..', '..');
}

describe('cross-release branding hygiene (live)', () => {
  const dirs: string[] = [];
  const prevConfig = process.env.CRAFT_CONFIG_DIR;
  let insertedRelease = false;

  afterAll(() => {
    if (insertedRelease) {
      try {
        psql(`DELETE FROM release_assets WHERE release_id = '${CROSS_RELEASE_ID}'`);
        psql(`DELETE FROM releases WHERE id = '${CROSS_RELEASE_ID}'`);
      } catch {
        // best-effort cleanup
      }
    }
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
  });

  it('VAL-CROSS-018: higher release row surfaces on gateway latest + updater feed URLs', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const login = await loginGateway(USER, PASS, GATEWAY);
    expect(login.success).toBe(true);
    if (!login.success) return;
    const token = await getStoredGatewayToken();
    expect(token).not.toBeNull();

    psql(`DELETE FROM release_assets WHERE release_id = '${CROSS_RELEASE_ID}'`);
    psql(
      `DELETE FROM releases WHERE id = '${CROSS_RELEASE_ID}' OR version = '${CROSS_RELEASE_VERSION}'`,
    );
    psql(
      `INSERT INTO releases (id, version, notes, pub_date, is_latest, created_at) VALUES ('${CROSS_RELEASE_ID}', '${CROSS_RELEASE_VERSION}', 'cross-val', NOW() + interval '1 year', true, NOW())`,
    );
    psql(
      `INSERT INTO release_assets (release_id, platform, download_url, signature, file_size) VALUES ('${CROSS_RELEASE_ID}', 'darwin-aarch64', 'https://example.invalid/ocn-cross.zip', 'sig-cross', 12345)`,
    );
    insertedRelease = true;

    const latestRes = await fetch(`${GATEWAY}/api/desktop/release/latest`, {
      headers: { Authorization: `Bearer ${token!}` },
    });
    expect(latestRes.status).toBe(200);
    const latestJson = (await latestRes.json()) as { version?: string };
    expect(latestJson.version).toBe(CROSS_RELEASE_VERSION);

    const feedBase = resolveGatewayUpdaterFeedBaseUrl(GATEWAY);
    expect(feedBase).toContain('/api/desktop/release');
    expect(feedBase).not.toMatch(/craft\.do|github\.com/);

    const ymlRes = await fetch(`${feedBase}/latest-mac.yml`, {
      headers: { Authorization: `Bearer ${token!}` },
    });
    expect(ymlRes.status).toBe(200);
    const yml = await ymlRes.text();
    expect(yml).toContain(`version: ${CROSS_RELEASE_VERSION}`);
    expect(resolveGatewayReleaseLatestUrl(GATEWAY)).toBe(
      `${GATEWAY.replace(/\/+$/, '')}/api/desktop/release/latest`,
    );

    await logoutGateway();
  });

  it('VAL-CROSS-023: unified OriginCoworks branding on desktop, WebUI, and CLI surfaces', () => {
    const root = repoRoot();

    const electronPkg = JSON.parse(
      readFileSync(join(root, 'apps/electron/package.json'), 'utf8'),
    ) as { description?: string };
    expect(electronPkg.description).toContain('OriginCoworks');
    expect(electronPkg.description).not.toContain('Craft Agents');

    const rendererHtml = readFileSync(join(root, 'apps/electron/src/renderer/index.html'), 'utf8');
    expect(rendererHtml).toContain(`<title>${PRODUCT_NAME}</title>`);
    expect(rendererHtml).not.toMatch(/Craft Agents/i);

    const webuiLogin = readFileSync(join(root, 'apps/webui/src/login.html'), 'utf8');
    expect(webuiLogin).toMatch(/OriginCoworks/i);
    expect(webuiLogin).not.toMatch(/Craft Agents|craft-cli|craft\.do/i);

    const webuiIndex = readFileSync(join(root, 'apps/webui/src/index.html'), 'utf8');
    expect(webuiIndex).toMatch(/OriginCoworks/i);
    expect(webuiIndex).not.toMatch(/Craft Agents/i);

    const builder = readFileSync(join(root, 'apps/electron/electron-builder.yml'), 'utf8');
    expect(builder).toContain('productName: OriginCoworks Next');
    expect(builder).toContain('com.origincoworks.next');
    expect(builder).not.toMatch(/com\.lukilabs\.craft-agent/);

    const autoUpdate = readFileSync(join(root, 'apps/electron/src/main/auto-update.ts'), 'utf8');
    expect(autoUpdate).toContain('resolveGatewayUpdaterFeedBaseUrl');
    expect(autoUpdate).not.toMatch(/agents\.craft\.do/);

    const cliHelp = execSync(`cd ${join(root, 'apps/cli')} && bun run src/index.ts --help`, {
      encoding: 'utf8',
    });
    expect(cliHelp).toMatch(/OriginCoworks/i);
    expect(cliHelp).not.toMatch(/craft-cli|Craft Agents/i);
  });

  it('VAL-CROSS-024: desktop journey never exposes non-LLM gateway secrets', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const secretValues: string[] = [];
    for (const key of NON_LLM_SETTING_KEYS) {
      const val = psql(`SELECT value FROM system_settings WHERE key = '${key}' LIMIT 1`);
      if (val && val.length >= 8) secretValues.push(val);
    }
    expect(secretValues.length).toBeGreaterThan(0);

    const configRoot = mkdtempSync(join(tmpdir(), 'ocn-cross-024-'));
    dirs.push(configRoot);
    process.env.CRAFT_CONFIG_DIR = configRoot;

    const login = await loginGateway(USER, PASS, GATEWAY);
    expect(login.success).toBe(true);
    if (!login.success) return;
    const token = await getStoredGatewayToken();
    expect(token).not.toBeNull();

    const configBody = await fetchDesktopConfig(GATEWAY, token!);
    const configRaw = JSON.stringify(configBody);

    for (const key of [
      'openai_api_key',
      'exa_api_key',
      'tavily_api_key',
      'fal_api_key',
      'mineru_token',
      'jimeng_api_key',
      'asset_gateway_token',
      'ai_search_token',
    ]) {
      expect(configRaw).not.toContain(`"${key}"`);
    }
    for (const secret of secretValues) {
      expect(configRaw).not.toContain(secret);
    }
    expect(configBody.llm_proxy_key?.length).toBeGreaterThan(0);

    await applyGatewayLlmConfigFromSession({
      reinitializeAuth: async () => {},
    });

    const configPath = join(configRoot, 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const onDiskConfig = readFileSync(configPath, 'utf8');
    for (const secret of secretValues) {
      expect(onDiskConfig).not.toContain(secret);
    }
    const stored = loadStoredConfig();
    expect(stored?.llmConnections?.some((c) => c.slug === ORIGINCOWORKS_GATEWAY_LLM_SLUG)).toBe(
      true,
    );

    await postAuditEvent(GATEWAY, token!, {
      action: 'cross_val_024_probe',
      resource_type: 'integration',
      resource_id: 'no-secrets-in-audit',
    });

    const auditRow = psql(
      `SELECT COALESCE(resource_id,'') || COALESCE(action,'') FROM audit_logs WHERE user_id = (SELECT id FROM users WHERE name = '${USER}' LIMIT 1) ORDER BY created_at DESC LIMIT 1`,
    );
    for (const secret of secretValues) {
      expect(auditRow).not.toContain(secret);
    }

    await logoutGateway();
  });
});
