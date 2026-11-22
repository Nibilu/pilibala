import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePiModelConfiguredAndAvailable,
  listPiModels,
  resetPiModelsCacheForTests,
} from "./models.js";

describe("pi models", () => {
  afterEach(() => {
    delete process.env.PILIBALA_PI_COMMAND;
    resetPiModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PILIBALA_PI_COMMAND = "__pilibala_missing_pi_command__";
    await expect(listPiModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensurePiModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("Pi requires `adapterConfig.model`");
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PILIBALA_PI_COMMAND = "__pilibala_missing_pi_command__";
    await expect(
      ensurePiModelConfiguredAndAvailable({
        model: "xai/grok-4",
      }),
    ).rejects.toThrow();
  });

  // AMB-326 regression baseline: the default-connection model id must stay
  // registry-qualified (`<provider>/<model>`, slash intact even when the model
  // id itself carries a vendor prefix) and the label must be the bare id —
  // the CLI's inference-parameter columns (context/max-out/thinking/images)
  // must not ride along in the model name.
  it("keeps nvidia vendor-prefixed ids intact and drops parameter columns from the label", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pilibala-pi-models-"));
    const command = join(directory, "pi");
    await writeFile(
      command,
      "#!/bin/sh\n"
      + "printf 'provider  model  context  max-out  thinking  images\\n'\n"
      + "printf 'nvidia  minimaxai/minimax-m3.1-flash  196k  100k  yes  no\\n'\n"
      + "printf 'nvidia  z-ai/glm-5.3-flash  200k  128k  yes  yes\\n'\n",
    );
    await chmod(command, 0o755);
    process.env.PILIBALA_PI_COMMAND = command;

    try {
      await expect(listPiModels()).resolves.toEqual([
        { id: "nvidia/minimaxai/minimax-m3.1-flash", label: "nvidia/minimaxai/minimax-m3.1-flash" },
        { id: "nvidia/z-ai/glm-5.3-flash", label: "nvidia/z-ai/glm-5.3-flash" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not embed the model catalogue when the configured model is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pilibala-pi-models-"));
    const command = join(directory, "pi");
    const modelIds = Array.from({ length: 13 }, (_, index) => `provider/model-${index}`);
    await writeFile(
      command,
      `#!/bin/sh\nprintf 'provider  model\\n';\n${modelIds
        .map((id) => {
          const [provider, model] = id.split("/");
          return `printf '${provider}  ${model}\\n'`;
        })
        .join(";\n")}\n`,
    );
    await chmod(command, 0o755);

    try {
      await expect(
        ensurePiModelConfiguredAndAvailable({
          command,
          model: "provider/missing",
        }),
      ).rejects.toMatchObject({
        message:
          "Configured Pi model is unavailable: provider/missing. 13 models are available; list them with `pi --list-models`.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
