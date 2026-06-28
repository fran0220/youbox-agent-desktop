import { createMemoryMcpServer, type MemoryToolDeps } from '@craft-agent/origincoworks/memory-tools';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { MEMORY_SOURCE_SLUG } from '@craft-agent/shared/sources/memory-source';
import type { LoadedSource } from '@craft-agent/shared/sources';

async function resolveGatewayClient(): Promise<GatewayClient | null> {
  const token = await getStoredGatewayToken();
  if (!token) return null;
  return new GatewayClient(resolveGatewayBaseUrl(), token);
}

export function buildMemoryMcpServerForSource(
  source: LoadedSource,
  options?: Pick<MemoryToolDeps, 'confirmDestructive'>,
) {
  if (source.config.type !== 'memory' || source.config.slug !== MEMORY_SOURCE_SLUG) {
    return null;
  }
  return createMemoryMcpServer({
    workspaceRoot: source.workspaceRootPath,
    getClient: resolveGatewayClient,
    confirmDestructive: options?.confirmDestructive,
  });
}
