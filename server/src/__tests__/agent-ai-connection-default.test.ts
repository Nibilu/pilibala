import { describe, expect, it } from "vitest";

import { defaultAiConnectionForHire, pickDefaultRunConnection } from "../services/agent-ai-connection-default.js";

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

describe("pickDefaultRunConnection", () => {
  const base = { id: "c1", grantId: "g1", provider: "openai" as const };
  it("prefers the user's marked default among compatible candidates", () => {
    const picked = pickDefaultRunConnection([
      { ...base, status: "connected", ownership: "shared" },
      { ...base, id: "c2", grantId: "g2", status: "connected", ownership: "shared", isDefault: true },
    ], () => true);
    expect(picked?.id).toBe("c2");
  });
  it("prefers the company-shared connection over personal ones", () => {
    const picked = pickDefaultRunConnection([
      { ...base, status: "connected", ownership: "personal" },
      { ...base, id: "c2", grantId: "g2", status: "connected", ownership: "shared" },
    ], () => true);
    expect(picked?.id).toBe("c2");
  });
  it("returns the sole compatible candidate", () => {
    const picked = pickDefaultRunConnection([{ ...base, status: "connected", ownership: "shared" }], () => true);
    expect(picked?.id).toBe("c1");
  });
  it("skips non-connected and incompatible candidates", () => {
    expect(pickDefaultRunConnection([{ ...base, status: "needs_attention", ownership: "shared" }], () => true)).toBeUndefined();
    expect(pickDefaultRunConnection([{ ...base, status: "connected", ownership: "shared" }], () => false)).toBeUndefined();
  });
  it("refuses to guess between multiple ambiguous personal candidates", () => {
    expect(pickDefaultRunConnection([
      { ...base, status: "connected", ownership: "personal" },
      { ...base, id: "c2", grantId: "g2", status: "connected", ownership: "personal" },
    ], () => true)).toBeUndefined();
  });
});
