import { describe, expect, test } from "bun:test";

import {
  ApprovalRuleChain,
  DEFAULT_APPROVAL_RULES,
  APPROVAL_DECISION_LABEL,
  lowRiskToolRule,
  strictApprovalRule,
  taskFreePassRule,
  type ApprovalRuleContext,
} from "../../src/daemon/approval-rules.ts";

function baseContext(overrides: Partial<ApprovalRuleContext> = {}): ApprovalRuleContext {
  return {
    adapter: "codex",
    taskFreePassEnabled: false,
    strictApproval: false,
    ...overrides,
  };
}

describe("approval rule chain", () => {
  test("task free-pass auto-allows when enabled", () => {
    const chain = new ApprovalRuleChain();
    expect(chain.decide(baseContext({ taskFreePassEnabled: true }))).toBe("allow");
  });

  test("low-risk read tools auto-allow without strict mode", () => {
    const chain = new ApprovalRuleChain();
    expect(chain.decide(baseContext({ toolName: "read" }))).toBe("allow");
    expect(chain.decide(baseContext({ toolName: "grep" }))).toBe("allow");
    expect(chain.decide(baseContext({ toolName: "web_search" }))).toBe("allow");
  });

  test("unknown tools ask when no rule applies", () => {
    const chain = new ApprovalRuleChain();
    expect(chain.decide(baseContext({ toolName: "write_file" }))).toBeNull();
  });

  test("strict approval blocks low-risk auto-allow", () => {
    const chain = new ApprovalRuleChain();
    expect(chain.decide(baseContext({ toolName: "read", strictApproval: true }))).toBe("ask");
    expect(chain.decide(baseContext({ taskFreePassEnabled: true, strictApproval: true }))).toBe("ask");
  });

  test("default rules are stable and labelled", () => {
    const ids = DEFAULT_APPROVAL_RULES.map((rule) => rule.id);
    expect(ids).toEqual(["strict-approval", "low-risk-tool", "task-free-pass"]);
    for (const rule of DEFAULT_APPROVAL_RULES) {
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });

  test("chain replace is undoable", () => {
    const chain = new ApprovalRuleChain([lowRiskToolRule]);
    const previous = chain.replace([taskFreePassRule]);
    expect(previous.map((rule) => rule.id)).toEqual(["low-risk-tool"]);
    expect(chain.list().map((rule) => rule.id)).toEqual(["task-free-pass"]);
    expect(chain.decide(baseContext({ taskFreePassEnabled: true }))).toBe("allow");
    chain.replace(previous);
    expect(chain.list().map((rule) => rule.id)).toEqual(["low-risk-tool"]);
  });

  test("decision labels are non-empty", () => {
    for (const label of Object.values(APPROVAL_DECISION_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(strictApprovalRule.id).toBe("strict-approval");
  });
});
