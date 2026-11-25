import { describe, expect, it } from "vitest";
import { buildPiLocalConfig } from "./build-config.js";
import type { CreateConfigValues } from "@pilibalaai/adapter-utils";

/** AMB-333: schema-driven Harness/Runtime settings persist from create flows. */
describe("buildPiLocalConfig", () => {
  it("merges schema-driven settings from adapterSchemaValues", () => {
    const config = buildPiLocalConfig({
      adapterSchemaValues: {
        stdoutLogMode: "raw",
        pilibalaApiUrl: "https://pilibala.example.com",
        promptTemplate: "Custom template",
      },
    } as unknown as CreateConfigValues);
    expect(config.stdoutLogMode).toBe("raw");
    expect(config.pilibalaApiUrl).toBe("https://pilibala.example.com");
    expect(config.promptTemplate).toBe("Custom template");
  });

  it("leaves configs without adapterSchemaValues unchanged", () => {
    const config = buildPiLocalConfig({
      model: "openai/gpt-5.4-mini",
    } as unknown as CreateConfigValues);
    expect(config.stdoutLogMode).toBeUndefined();
    expect(config.pilibalaApiUrl).toBeUndefined();
    expect(config.promptTemplate).toBeUndefined();
    expect(config.model).toBe("openai/gpt-5.4-mini");
  });
});
