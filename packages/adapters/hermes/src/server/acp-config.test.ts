import { describe, expect, test } from "vitest";

import { buildHermesAcpConfig } from "./acp.js";

describe("buildHermesAcpConfig provider↔model transport guard", () => {
  test("qualifies the model id with the explicit provider so the association survives the ACP transport", () => {
    const config = buildHermesAcpConfig({
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4.1-flash",
    });
    expect(config.model).toBe("nvidia:deepseek-ai/deepseek-v4.1-flash");
    expect(config.agent).toBe("hermes");
  });

  test("does not double-prefix an already qualified id", () => {
    const config = buildHermesAcpConfig({
      provider: "nvidia",
      model: "nvidia:deepseek-ai/deepseek-v4.1-flash",
    });
    expect(config.model).toBe("nvidia:deepseek-ai/deepseek-v4.1-flash");
  });

  test("leaves the model untouched without an explicit provider (Hermes native resolution)", () => {
    expect(buildHermesAcpConfig({ model: "deepseek-ai/deepseek-v4.1-flash" }).model).toBe(
      "deepseek-ai/deepseek-v4.1-flash",
    );
    expect(buildHermesAcpConfig({}).model).toBeUndefined();
  });

  test("ignores an auto provider", () => {
    expect(
      buildHermesAcpConfig({ provider: "auto", model: "deepseek-ai/deepseek-v4.1-flash" }).model,
    ).toBe("deepseek-ai/deepseek-v4.1-flash");
  });

  // AMB-326 T0: a config.yaml custom_providers gateway is not in Hermes's
  // `_KNOWN_PROVIDER_NAMES`, so `<name>:<model>` rides the transport undecoded.
  // Hermes's decodable form for those is `custom:<name>:<model>`.
  test("qualifies a custom provider through the decodable custom:<name>:<model> form", () => {
    const config = buildHermesAcpConfig(
      { provider: "proxy-router", model: "qwen2.5-72b-instruct" },
      new Set(["proxy-router"]),
    );
    expect(config.model).toBe("custom:proxy-router:qwen2.5-72b-instruct");
  });

  test("does not double-prefix an already custom-qualified id", () => {
    const config = buildHermesAcpConfig(
      { provider: "proxy-router", model: "custom:proxy-router:qwen2.5-72b-instruct" },
      new Set(["proxy-router"]),
    );
    expect(config.model).toBe("custom:proxy-router:qwen2.5-72b-instruct");
  });

  test("keeps the registry colon form when no custom hints are available", () => {
    const config = buildHermesAcpConfig(
      { provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" },
      undefined,
    );
    expect(config.model).toBe("nvidia:deepseek-ai/deepseek-v4.1-flash");
  });
});
