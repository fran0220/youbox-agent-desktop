/**
 * Gateway role / workspace-trust policy evaluation for runPreToolUseChecks.
 * HTTP fetch lives in @craft-agent/origincoworks/policy.ts; this module is pure logic.
 */

export interface GatewayPolicyFlags {
  allow_bash: boolean;
  allow_file_write: boolean;
  allow_mcp: boolean;
  allow_api_mutations: boolean;
}

export interface GatewayPolicySnapshot {
  role: string;
  flags: GatewayPolicyFlags;
  workspace_trust_default: boolean;
  /** Effective trust for the requested workspace (from GET /api/desktop/policy?workspace_slug=) */
  workspace_trusted?: boolean;
  require_high_risk_confirmation: boolean;
  require_admin_escalation_approval: boolean;
}

export type GatewayPolicyBlockSource = 'gateway_role' | 'workspace_trust';

export interface GatewayPolicyEvaluateInput {
  toolName: string;
  input: Record<string, unknown>;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  policy?: GatewayPolicySnapshot;
  workspaceTrusted?: boolean;
}

export type GatewayPolicyEvaluateResult =
  | { allowed: true }
  | { allowed: false; reason: string; source: GatewayPolicyBlockSource };

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const HIGH_RISK_BASH_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-[a-zA-Z]*r[a-zA-Z]*\s+).*\s(-[a-zA-Z]*r[a-zA-Z]*\s+|-[a-zA-Z]*f[a-zA-Z]*\s+)/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bgit\s+push\b[^|\n]*--force\b/i,
  /\bgit\s+push\s+-f\b/i,
];

export function isHighRiskBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes('rm -rf') || lower.includes('rm -fr')) return true;
  return HIGH_RISK_BASH_PATTERNS.some((re) => re.test(trimmed));
}

function isMutatingApiTool(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName.startsWith('api_')) {
    const method = ((input.method as string) || 'GET').toUpperCase();
    return method !== 'GET' && method !== 'HEAD';
  }
  if (toolName.startsWith('mcp__') && toolName.includes('__api_')) {
    const method = ((input.method as string) || 'GET').toUpperCase();
    return method !== 'GET' && method !== 'HEAD';
  }
  return false;
}

function isMutatingMcpTool(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  if (toolName.startsWith('mcp__craft-agents-docs__')) return false;
  if (toolName.startsWith('mcp__session__')) return false;
  return true;
}

function isWriteLikeTool(toolName: string): boolean {
  return FILE_WRITE_TOOLS.has(toolName) || toolName === 'Bash';
}

/**
 * Layer gateway role + workspace trust above local permission modes.
 */
export function evaluateGatewayPolicy(ctx: GatewayPolicyEvaluateInput): GatewayPolicyEvaluateResult {
  const policy = ctx.policy;
  if (!policy) {
    return { allowed: true };
  }

  const workspaceTrusted =
    ctx.workspaceTrusted ?? policy.workspace_trusted ?? policy.workspace_trust_default;

  if (!workspaceTrusted && isWriteLikeTool(ctx.toolName)) {
    return {
      allowed: false,
      source: 'workspace_trust',
      reason:
        'This workspace is not trusted by gateway policy. File writes and shell commands are blocked until the workspace is marked trusted.',
    };
  }

  const flags = policy.flags;
  if (ctx.toolName === 'Bash' && !flags.allow_bash) {
    return {
      allowed: false,
      source: 'gateway_role',
      reason: `Gateway role policy (${policy.role}) does not permit Bash execution, regardless of the local permission mode.`,
    };
  }

  if (FILE_WRITE_TOOLS.has(ctx.toolName) && !flags.allow_file_write) {
    return {
      allowed: false,
      source: 'gateway_role',
      reason: `Gateway role policy (${policy.role}) does not permit file writes, regardless of the local permission mode.`,
    };
  }

  if (isMutatingMcpTool(ctx.toolName) && !flags.allow_mcp) {
    return {
      allowed: false,
      source: 'gateway_role',
      reason: `Gateway role policy (${policy.role}) does not permit MCP mutations, regardless of the local permission mode.`,
    };
  }

  if (isMutatingApiTool(ctx.toolName, ctx.input) && !flags.allow_api_mutations) {
    return {
      allowed: false,
      source: 'gateway_role',
      reason: `Gateway role policy (${policy.role}) does not permit API mutations, regardless of the local permission mode.`,
    };
  }

  return { allowed: true };
}

export interface HighRiskAllowAllPromptParams {
  toolName: string;
  input: Record<string, unknown>;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  policy?: GatewayPolicySnapshot;
  permissionManager: {
    isDangerousCommand(command: string): boolean;
    getBaseCommand(command: string): string;
  };
}

/**
 * In allow-all mode, high-risk bash still requires confirmation when policy demands it.
 */
export function shouldPromptHighRiskInAllowAll(params: HighRiskAllowAllPromptParams): boolean {
  if (params.permissionMode !== 'allow-all') return false;
  if (params.policy && !params.policy.require_high_risk_confirmation) return false;
  if (params.toolName !== 'Bash') return false;
  const command = typeof params.input.command === 'string' ? params.input.command : '';
  if (!command) return false;
  const base = params.permissionManager.getBaseCommand(command);
  if (params.permissionManager.isDangerousCommand(base) || isHighRiskBashCommand(command)) {
    return true;
  }
  return false;
}
