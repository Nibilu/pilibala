import { configFieldsForSection } from "../config-sections";
import { SchemaConfigFields } from "../schema-config-fields";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function PiLocalConfigFields(props: AdapterConfigFieldsProps) {
  const { section, hideInstructionsFile } = props;
  // AMB-333 (hermes parity): the Harness/Runtime settings come from the
  // declarative schema served by pi_local's getConfigSchema() (run-log
  // quiet/verbose mode, Pilibala API URL override, prompt template) and
  // render through the shared SchemaConfigFields. SchemaConfigFields filters
  // fields by section itself; configFieldsForSection keeps this component's
  // section contract for the instructions-file field below.
  return configFieldsForSection(section, (
    <>
      <SchemaConfigFields {...props} />
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                props.isCreate
                  ? props.values!.instructionsFilePath ?? ""
                  : props.eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(props.config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                props.isCreate
                  ? props.set!({ instructionsFilePath: v })
                  : props.mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
    </>
  ));
}
