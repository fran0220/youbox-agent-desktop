export { GatewayClient, GatewayHttpError } from './gateway-client.ts';
export type {
  DesktopConfig,
  DesktopConfigModelEntry,
  DesktopConfigResponse,
  GatewayUser,
  GatewayUserRole,
  LoginResponse,
  MeResponse,
} from './types.ts';
export {
  assertDesktopConfigResponse,
  assertGatewayUser,
  assertLoginResponse,
  isGatewayUser,
} from './types.ts';
export { fetchDesktopConfig } from './desktop-config.ts';
export { mapGatewayModelsToCraft } from './model-config.ts';
export {
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
  applyGatewayLlmConfigFromSession,
  buildGatewayLlmConnectionFromDesktopConfig,
  isGatewayManagedLlmSlug,
} from './llm-config.ts';
export type { ApplyGatewayLlmConfigDeps } from './llm-config.ts';
export type { GatewayPolicySnapshot, GatewayPolicyFlags } from './policy.ts';
export {
  mapDesktopPolicyResponse,
  fetchDesktopPolicy,
  getCachedGatewayPolicy,
  clearGatewayPolicyCacheForTests,
  evaluateGatewayPolicy,
  isHighRiskBashCommand,
  shouldPromptHighRiskInAllowAll,
} from './policy.ts';
export type { AuditEventPayload } from './audit.ts';
export { postAuditEvent, sanitizeAuditResourceId } from './audit.ts';
export {
  clearGatewaySession,
  getGatewaySessionState,
  getStoredGatewayToken,
  loginGateway,
  logoutGateway,
  persistGatewaySession,
  resolveGatewayBaseUrl,
  sanitizeGatewayLoginError,
  GATEWAY_SESSION_CREDENTIAL,
} from './auth.ts';
export type {
  GatewayLoginResult,
  GatewaySessionState,
  GatewaySessionUnauthenticatedReason,
} from './auth.ts';
export type { GatewaySkillFile, GatewaySkillsChecksumResponse } from './types.ts';
export {
  syncGatewaySkillsToWorkspaces,
  applySkillFilesToWorkspace,
  readSkillsSyncState,
  writeSkillsSyncState,
  syncSkillsForOwner,
} from './skills-sync.ts';
export type { SkillsSyncResult, SkillsSyncState, PullOwnerSkillsFn } from './skills-sync.ts';
export { contentChecksum } from './checksum.ts';
export {
  resolveRequiredSourceEnables,
  formatSkippedRequiredSourcesWarning,
} from './required-sources.ts';
export type { RequiredSourcesResolution } from './required-sources.ts';
export {
  adaptLegacyMessage,
  adaptLegacyMessages,
  buildStoredSessionFromClassic,
  materializeImportedSession,
  syncClassicSessionsToWorkspace,
  IMPORTED_SESSION_LABEL,
  IMPORTED_SESSION_STATUS,
} from './session-import.ts';
export type { MaterializeImportedSessionResult, SyncClassicSessionsResult } from './session-import.ts';
export { isImportedGatewaySession, IMPORTED_SESSION_READ_ONLY_ERROR } from './is-imported-session.ts';
export {
  buildContinuedSessionName,
  buildImportedSessionFallbackSummary,
  canContinueFromImportedSession,
} from './continue-from-imported.ts';
export {
  DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS,
  resolveTransferredSessionSummary,
} from './resolve-transferred-session-summary.ts';
export type { LegacyTurnForSummary } from './resolve-transferred-session-summary.ts';
export type { ContinueFromImportedSessionResult } from './continue-from-imported.ts';
export {
  collectSkillFilesFromWorkspace,
  writeUserSkillToGateway,
  isGatewayEditableUserSkill,
} from './skill-writeback.ts';
export {
  shouldWriteSessionMetadataToGateway,
  writeSessionMetadataToGateway,
} from './session-metadata-writeback.ts';
export type { SessionMetadataWritebackPayload } from './session-metadata-writeback.ts';
export { craftSessionIdToGatewayChatSessionId } from './session-gateway-id.ts';
export type { SkillFilePayload, GatewaySkillSummary } from './skill-writeback.ts';
