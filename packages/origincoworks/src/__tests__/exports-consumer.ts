/**
 * Compile-time check that the package entry exports resolve (VAL-ENV-007).
 * Imported by gateway-client.test.ts via type-only import.
 */
import { GatewayClient } from '@craft-agent/origincoworks';
import type { GatewayUser, LoginResponse } from '@craft-agent/origincoworks';

export function consumerExportsResolve(
  _client: GatewayClient,
  _user: GatewayUser,
  _login: LoginResponse,
): void {}
