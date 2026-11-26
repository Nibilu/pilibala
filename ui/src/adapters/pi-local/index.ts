import type { UIAdapterModule } from "../types";
import { createPiStdoutParser, parsePiStdoutLine } from "@pilibalaai/adapter-pi-local/ui";
import { PiLocalConfigFields } from "./config-fields";
import { buildPiLocalConfig } from "@pilibalaai/adapter-pi-local/ui";

export const piLocalUIAdapter: UIAdapterModule = {
  type: "pi_local",
  label: "Pi",
  parseStdoutLine: parsePiStdoutLine,
  // Stateful parser: streamed deltas render once and the full-content
  // carriers (message_end/turn_end/agent_end) only emit the unseen tail —
  // same transcript style contract as the hermes adapters.
  createStdoutParser: createPiStdoutParser,
  ConfigFields: PiLocalConfigFields,
  buildAdapterConfig: buildPiLocalConfig,
};
