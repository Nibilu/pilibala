import { describe, expect, it } from "vitest";

import { defaultAiConnectionForHire } from "../services/agent-ai-connection-default.js";

describe("defaultAiConnectionForHire", () => {
  it("uses the child's responsible-user default for a compatible inherited shared binding", () => {
    const inheritedSharedBinding = {
      provider: "anthropic",
      method: "api_key",
      mode: "shared",
      connectionId: "00000000-0000-4000-8000-000000000001",
      grantId: "00000000-0000-4000-8000-000000000002",
    } as const;

    expect(defaultAiConnectionForHire("claude_local", {}, inheritedSharedBinding)).toEqual({
      provider: "anthropic",
      method: "api_key",
      mode: "responsible_user",
    });
  });
});
