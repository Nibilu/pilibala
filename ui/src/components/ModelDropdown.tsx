import { useMemo, useState } from "react";
import type { AdapterModel } from "@/api/agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, SelectPopover } from "@/components/ui/select";
import { cn } from "../lib/utils";
import { extractModelName, extractProviderId } from "../lib/model-utils";
import { groupModelsByProvider, type ModelAttributionContext } from "../lib/model-selection";
import { Field, help } from "./agent-config-primitives";

export function ModelDropdown({
  models,
  value,
  onChange,
  open,
  onOpenChange,
  allowDefault,
  required,
  groupByProvider,
  preserveOrder,
  providerAttribution,
  creatable,
  detectedModel,
  detectedModelCandidates,
  onDetectModel,
  onRefreshModels,
  refreshingModels,
  loadingModels,
  detectModelLabel,
  emptyDetectHint,
  defaultLabel,
  presentation = "searchable",
}: {
  models: AdapterModel[];
  value: string;
  onChange: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowDefault: boolean;
  required: boolean;
  groupByProvider: boolean;
  /** Keep the adapter's list order (curated lists) instead of sorting ungrouped entries by id. */
  preserveOrder?: boolean;
  /**
   * Provider attribution for the grouping (AMB-326 P2): connection-attributed
   * catalogs (gateway/local managed connections) group every entry under the
   * connection's own provider instead of the id's vendor-prefix segment.
   * Absent = unscoped adapter catalog — the id prefix stays the attribution.
   */
  providerAttribution?: ModelAttributionContext;
  creatable?: boolean;
  detectedModel?: string | null;
  detectedModelCandidates?: string[];
  onDetectModel?: () => Promise<string | null>;
  onRefreshModels?: () => Promise<void>;
  refreshingModels?: boolean;
  loadingModels?: boolean;
  detectModelLabel?: string;
  emptyDetectHint?: string;
  defaultLabel?: string;
  presentation?: "searchable" | "native";
}) {
  const [modelSearch, setModelSearch] = useState("");
  const [enteringCustomModel, setEnteringCustomModel] = useState(false);
  const [detectingModel, setDetectingModel] = useState(false);
  const selected = models.find((m) => m.id === value);
  const manualModel = modelSearch.trim();
  const canCreateManualModel = Boolean(
    creatable &&
      manualModel &&
      !models.some((m) => m.id.toLowerCase() === manualModel.toLowerCase()),
  );
  // Model IDs already shown as detected/candidate badges — exclude from regular list
  const promotedModelIds = useMemo(() => {
    const set = new Set<string>();
    if (detectedModel) set.add(detectedModel);
    for (const c of detectedModelCandidates ?? []) {
      if (c) set.add(c);
    }
    return set;
  }, [detectedModel, detectedModelCandidates]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (promotedModelIds.has(m.id)) return false;
      if (!modelSearch.trim()) return true;
      const q = modelSearch.toLowerCase();
      const provider = extractProviderId(m.id) ?? "";
      return (
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        provider.toLowerCase().includes(q)
      );
    });
  }, [models, modelSearch, promotedModelIds]);
  const groupedModels = useMemo(() => {
    if (!groupByProvider) {
      // A hand-ordered list (newest release of each family first, older releases at the end) is
      // shown as the adapter ordered it; a discovered list has no stable order, so sort it.
      const entries = preserveOrder ? filteredModels : [...filteredModels].sort((a, b) => a.id.localeCompare(b.id));
      return [{ provider: "models", entries }];
    }
    // Attribution goes through the shared model-selection core: unscoped
    // adapter catalogs keep the id-prefix derivation; a caller passing
    // connection attribution groups every entry under the connection's own
    // provider (AMB-326 P2).
    return groupModelsByProvider(filteredModels, providerAttribution ?? {}, { preserveOrder });
  }, [filteredModels, groupByProvider, preserveOrder, providerAttribution]);

  async function handleDetectModel() {
    if (!onDetectModel) return;
    setDetectingModel(true);
    try {
      const nextModel = await onDetectModel();
      if (nextModel) {
        onChange(nextModel);
        onOpenChange(false);
        setModelSearch("");
      }
    } finally {
      setDetectingModel(false);
    }
  }

  if (presentation === "native") {
    const customOption = "__pilibala_custom_model__";
    const extraModels = [...new Set([value, ...promotedModelIds])].filter(id => id && (!models.some(model => model.id === id) || promotedModelIds.has(id)));
    return (
      <Field label="Model" hint={help.model}>
        <NativeSelect
          aria-label="Model"
          aria-busy={loadingModels || refreshingModels}
          value={enteringCustomModel ? customOption : value}
          required={required && !enteringCustomModel}
          onChange={event => {
            const next = event.target.value;
            setEnteringCustomModel(next === customOption);
            if (next !== customOption) onChange(next);
          }}
        >
          <option value="" disabled={!allowDefault}>
            {allowDefault ? (defaultLabel ?? "Default") : loadingModels ? "Loading models…" : required ? "Select model (required)" : "Select model"}
          </option>
          {extraModels.map(id => <option key={id} value={id}>{models.find(model => model.id === id)?.label ?? id}</option>)}
          {groupedModels.map(({ provider, entries }) => groupByProvider ? (
            <optgroup key={provider} label={provider}>
              {entries.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </optgroup>
          ) : entries.map(model => <option key={model.id} value={model.id}>{model.label}</option>))}
          {creatable && <option value={customOption}>Enter custom model…</option>}
        </NativeSelect>
        {enteringCustomModel && (
          <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
            Model ID
            <Input aria-label="Model ID" value={value} onChange={event => onChange(event.target.value)}
              placeholder="Enter model ID or alias" autoFocus required={required} />
          </label>
        )}
        {loadingModels && <p role="status" className="mt-2 text-xs text-muted-foreground">Loading models…</p>}
        {onRefreshModels && <Button type="button" variant="ghost" size="sm" disabled={refreshingModels}
          onClick={() => void onRefreshModels()}>{refreshingModels ? "Refreshing…" : "Refresh models"}</Button>}
      </Field>
    );
  }

  return (
    <Field label="Model" hint={help.model}>
      <SelectPopover aria-label="Model" value={value}
        displayValue={<span className={cn("truncate", !value && "text-muted-foreground")}>
          {selected?.label ?? (value || (allowDefault ? (defaultLabel ?? "Default") : required ? "Select model (required)" : "Select model"))}
        </span>}
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          if (!nextOpen) setModelSearch("");
        }}
      >
        <div role="listbox" aria-label="Model">
          <div className="relative mb-1">
            <input
              className="w-full px-2 py-1.5 pr-6 text-xs bg-transparent outline-none border-b border-border placeholder:text-muted-foreground/50"
              placeholder={creatable ? "Search models... (type to create)" : "Search models..."}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              autoFocus
            />
            {modelSearch && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setModelSearch("")}
              >
                <svg aria-hidden="true" focusable="false" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          {onDetectModel && !modelSearch.trim() && (
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-muted-foreground"
              onClick={() => {
                void handleDetectModel();
              }}
              disabled={detectingModel}
            >
              <svg aria-hidden="true" focusable="false" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              {detectingModel ? "Detecting..." : detectedModel ? (detectModelLabel?.replace(/^Detect\b/, "Re-detect") ?? "Re-detect from config") : (detectModelLabel ?? "Detect from config")}
            </button>
          )}
          {onRefreshModels && !modelSearch.trim() && (
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-muted-foreground"
              onClick={() => {
                void onRefreshModels();
              }}
              disabled={refreshingModels}
            >
              <svg aria-hidden="true" focusable="false" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15.28-6.36L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15.28 6.36L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              {refreshingModels ? "Refreshing..." : "Refresh models"}
            </button>
          )}
          {value && (!models.some((m) => m.id === value) || promotedModelIds.has(value)) && (
            <button
              type="button"
              role="option" aria-selected
              className={cn(
                "flex items-center w-full px-2 py-1.5 text-sm rounded bg-accent/50",
              )}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              <span className="block w-full text-left truncate font-mono text-xs" title={value}>
                {models.find((m) => m.id === value)?.label ?? value}
              </span>
              <Badge variant="outline" className="ml-auto text-(length:--text-nano) px-1.5 bg-green-500/15 text-green-400 border-green-500/20">
                current
              </Badge>
            </button>
          )}
          {detectedModel && detectedModel !== value && (
            <button
              type="button"
              role="option" aria-selected={false}
              className={cn(
                "flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
              )}
              onClick={() => {
                onChange(detectedModel);
                onOpenChange(false);
              }}
            >
              <span className="block w-full text-left truncate font-mono text-xs" title={detectedModel}>
                {models.find((m) => m.id === detectedModel)?.label ?? detectedModel}
              </span>
              <Badge variant="outline" className="ml-auto text-(length:--text-nano) px-1.5 bg-blue-500/15 text-blue-400 border-blue-500/20">
                detected
              </Badge>
            </button>
          )}
          {detectedModelCandidates
            ?.filter((candidate) => candidate && candidate !== detectedModel && candidate !== value)
            .map((candidate) => {
              const entry = models.find((m) => m.id === candidate);
              return (
                <button
                  key={`detected-${candidate}`}
                  type="button"
                  role="option" aria-selected={false}
                  className={cn(
                    "flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                  )}
                  onClick={() => {
                    onChange(candidate);
                    onOpenChange(false);
                  }}
                >
                  <span className="block w-full text-left truncate font-mono text-xs" title={candidate}>
                    {entry?.label ?? candidate}
                  </span>
                  <Badge variant="outline" className="ml-auto text-(length:--text-nano) px-1.5 bg-sky-500/15 text-sky-400 border-sky-500/20">
                    config
                  </Badge>
                </button>
              );
            })}
          <div className="max-h-(--sz-240px) overflow-y-auto">
            {allowDefault && (
              <button
                type="button"
                role="option" aria-selected={!value}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                  !value && "bg-accent",
                )}
                onClick={() => {
                  onChange("");
                  onOpenChange(false);
                }}
              >
                Default
              </button>
            )}
            {canCreateManualModel && (
              <button
                type="button"
                role="option" aria-selected={false}
                className="flex items-center justify-between gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50"
                onClick={() => {
                  onChange(manualModel);
                  onOpenChange(false);
                  setModelSearch("");
                }}
              >
                <span>Use manual model</span>
                <span className="text-xs font-mono text-muted-foreground">{manualModel}</span>
              </button>
            )}
            {groupedModels.map((group) => (
              <div key={group.provider} className="mb-1 last:mb-0">
                {groupByProvider && (
                  <div className="px-2 py-1 text-(length:--text-nano) uppercase tracking-wide text-muted-foreground">
                    {group.provider} ({group.entries.length})
                  </div>
                )}
                {group.entries.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    role="option" aria-selected={m.id === value}
                    className={cn(
                      "flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                      m.id === value && "bg-accent",
                    )}
                    onClick={() => {
                      onChange(m.id);
                      onOpenChange(false);
                    }}
                  >
                    <span className="block w-full text-left truncate" title={m.id}>
                      {groupByProvider ? extractModelName(m.id) : m.label}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {filteredModels.length === 0 && !canCreateManualModel && promotedModelIds.size === 0 && (
              <div className="px-2 py-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {loadingModels ? "Loading models…" : onDetectModel
                    ? (emptyDetectHint ?? "No model detected yet. Enter a provider/model manually.")
                    : "No models found."}
                </p>
              </div>
            )}
          </div>
        </div>
      </SelectPopover>
    </Field>
  );
}
