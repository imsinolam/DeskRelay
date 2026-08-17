/**
 * Composable approval rules (DSH-inspired "intercept": rules layered on top
 * of a capability, with identity, replaceability and undo).
 *
 * A rule receives an approval context and returns a decision, or null when
 * the rule does not apply. Rules are composed into a chain; the first rule
 * that returns a decision wins. Rules have stable ids so the mobile settings
 * panel and doctor can list what is active, and so future self-improvement
 * can attribute a decision to a specific rule instead of to the whole
 * approval path.
 */

export type ApprovalDecision = "allow" | "ask" | "deny";

export type ApprovalRuleContext = {
  adapter: string;
  toolName?: string;
  commandPreview?: string;
  taskIdentityKey?: string;
  /** True when the task already has a free-pass enabled for today. */
  taskFreePassEnabled: boolean;
  /** True when strict approval is configured (all approvals go remote). */
  strictApproval: boolean;
};

export type ApprovalRule = {
  id: string;
  label: string;
  description: string;
  match(ctx: ApprovalRuleContext): ApprovalDecision | null;
};

export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  allow: "自动允许",
  ask: "询问",
  deny: "拒绝",
};

/** Rules that are always safe to skip asking for (read-only, harmless). */
const LOW_RISK_TOOL_NAMES = new Set([
  "read",
  "list",
  "ls",
  "grep",
  "search",
  "web_search",
  "fetch",
  "bash",
  "shell",
]);

/**
 * In strict mode every approval request is sent to the remote end.
 * This is the default ask-everything rule; it exists so the chain can
 * express "no silent auto-approve" explicitly.
 */
export const strictApprovalRule: ApprovalRule = {
  id: "strict-approval",
  label: "严格审批",
  description: "所有审批请求都交给远程端确认，不自动通过。",
  match(ctx) {
    return ctx.strictApproval ? "ask" : null;
  },
};

/** Low-risk read-only tools may pass without asking. */
export const lowRiskToolRule: ApprovalRule = {
  id: "low-risk-tool",
  label: "低风险工具自动通过",
  description: "只读或无害的工具调用（如读取、搜索）自动允许。",
  match(ctx) {
    if (ctx.strictApproval) return null;
    const tool = (ctx.toolName ?? "").toLowerCase();
    return LOW_RISK_TOOL_NAMES.has(tool) ? "allow" : null;
  },
};

/**
 * Task free-pass: once the user enables "今日内本任务免审" for a task,
 * subsequent approvals in that task are auto-allowed.
 */
export const taskFreePassRule: ApprovalRule = {
  id: "task-free-pass",
  label: "任务免审",
  description: "已开启免审的任务，后续审批自动接受；新任务恢复逐项审批。",
  match(ctx) {
    return ctx.taskFreePassEnabled ? "allow" : null;
  },
};

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  strictApprovalRule,
  lowRiskToolRule,
  taskFreePassRule,
];

export class ApprovalRuleChain {
  private rules: ApprovalRule[];

  constructor(rules: ApprovalRule[] = DEFAULT_APPROVAL_RULES) {
    this.rules = [...rules];
  }

  /** Evaluate the chain; returns the first applicable decision. */
  decide(ctx: ApprovalRuleContext): ApprovalDecision | null {
    for (const rule of this.rules) {
      const decision = rule.match(ctx);
      if (decision !== null) {
        return decision;
      }
    }
    return null;
  }

  /** The active rule list, for settings/doctor display. */
  list(): ApprovalRule[] {
    return [...this.rules];
  }

  /** Replace the chain with a new rule set (undoable by restoring the old). */
  replace(rules: ApprovalRule[]): ApprovalRule[] {
    const previous = this.rules;
    this.rules = [...rules];
    return previous;
  }
}
