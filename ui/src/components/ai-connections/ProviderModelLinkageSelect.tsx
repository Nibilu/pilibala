import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  aiConnectionBindingSchema,
  isAiConnectionCompatible,
  type AiConnectionBinding,
  type AiRuntimeConnectionBinding,
} from "@pilibalaai/shared";
import type { AdapterModel } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { resolveConnectionModelLinkage } from "@/lib/connection-model-linkage";
import { ModelDropdown } from "../ModelDropdown";
import { AiConnectionField } from "./AiConnectionField";
import { useConnectionModels } from "./useConnectionModels";
import { describeError } from "@/api/errors";

/**
 * Provider·model linkage selection (AMB-311 plan §2).
 *
 * One implementation of the "harness × connection × model" glue shared by the
 * create-agent runtime screen, the agent Harness/Runtime form and (later) the
 * composer run-settings picker:
 *
 * - `useProviderModelLinkage` — owns the shared logic: the bound connection's
 *   model catalog with the harness catalog as fallback, transport resolution
 *   (`aiRoutingModel`), and the connection↔model auto-rebind effect
 *   (`resolveConnectionModelLinkage`).
 * - `ProviderModelLinkageModelSelect` — the model dropdown rendered in the
 *   stacked form layout (Harness/Runtime config), with optional error and
 *   auto-rebind notices.
 * - `ProviderModelLinkageConnection` — the managed-connection field
 *   (compatibility-filtered list, "Responsible user's default",
 *   "Connect an account…"), optionally collapsed under the hermes-style
 *   Advanced disclosure, plus the "no compatible connection" reason.
 * - `ProviderModelLinkageSelect` — the composite for the adjacent
 *   create-agent layout (connection field, then the model/effort grid).
 *
 * Site-specific UI that genuinely differs per surface (model provider
 * selector, thinking-effort control, setup credential fields, error chains
 * with retry, write targets) stays at the call site.
 */

export interface ProviderModelLinkageSharedProps {
  companyId: string | null;
  agentId?: string;
  /** Harness identity (aiRoutingHarness result). */
  harness: string;
  /** Disable the auto-rebind effect (create mode / external runners). */
  linkageDisabled?: boolean;
  /** Called after the effect rebinds the connection. */
  onAutoRebind: (connectionName: string, binding: AiConnectionBinding) => void;
}

export function useProviderModelLinkage({
  companyId,
  harness,
  linkageDisabled,
  onAutoRebind,
  onModelSelect,
  modelValue,
  binding,
  fallbackModels,
  fallbackModelsLoading,
  providerBaseUrl,
}: Omit<ProviderModelLinkageSharedProps, "agentId"> & {
  modelValue: string;
  /** Managed binding the model catalog follows (`undefined` = host default). */
  binding: AiConnectionBinding | undefined;
  /** Resolved catalog when no managed connection overrides it (call-site chain). */
  fallbackModels: AdapterModel[];
  /** Loading flag of the fallback catalog (already per-site). */
  fallbackModelsLoading?: boolean;
  /** baseUrl of the chosen adapter-catalog provider (linkage preference input). */
  providerBaseUrl?: string | null;
  onModelSelect: (resolvedId: string, rawId: string) => void;
}) {
  const connectionModels = useConnectionModels(
    companyId,
    binding,
    harness,
  );
  const [autoReboundConnection, setAutoReboundConnection] = useState<string | null>(null);
  const rebindRef = useRef<string | null>(null);
  // Hold the select callback in a per-instance ref so the linkage effect's
  // dependency list stays free of per-render identities while the callback
  // stays fresh (same ref-during-render pattern AgentConfigForm uses).
  const onModelSelectRef = useRef(onModelSelect);
  onModelSelectRef.current = onModelSelect;

  // Connection ↔ model linkage (managed connections only): when the chosen
  // model is not in the bound connection's catalog, identify the compatible
  // company connection that serves it and hand the rebinding to the call site.
  const accounts = useQuery({
    queryKey: ["ai-connections-linkage", companyId],
    queryFn: () => aiConnectionsApi.list(companyId!),
    enabled: Boolean(companyId && !linkageDisabled),
    staleTime: 15_000,
    retry: false,
  });
  useEffect(() => {
    if (linkageDisabled || !companyId) return;
    const accountsData = accounts.data;
    if (!accountsData) return;
    const suggestion = resolveConnectionModelLinkage({
      harness,
      model: modelValue || undefined,
      binding,
      connections: accountsData.connections,
      currentUserId: accountsData.currentUserId,
      providerBaseUrl,
    });
    if (!suggestion) return;
    if (rebindRef.current === suggestion.connectionName) return;
    rebindRef.current = suggestion.connectionName;
    setAutoReboundConnection(suggestion.connectionName);
    onAutoRebind(suggestion.connectionName, suggestion.binding);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAutoRebind is the write target, not a data input; the rebindRef guard prevents write loops
  }, [linkageDisabled, companyId, accounts.data, harness, modelValue, binding, providerBaseUrl, onAutoRebind]);

  const models = connectionModels?.models ?? fallbackModels;
  const loadingModels = connectionModels?.isLoading ?? (fallbackModelsLoading ?? false);
  const dropdownProps = {
    models,
    loadingModels,
    value: modelValue,
    onChange: (id: string) => {
      onModelSelectRef.current(connectionModels?.resolveModel(id) ?? id, id);
    },
    onRefreshModels: connectionModels?.refreshModels,
    refreshingModels: connectionModels?.refreshing,
  } as const;
  return {
    connectionModels,
    models,
    loadingModels,
    autoReboundConnection,
    dropdownProps,
    /** Connection-catalog error, if the bound connection's catalog failed to load. */
    connectionModelError: connectionModels?.error ?? null,
  };
}

export type ModelDropdownSiteProps = Omit<
  Parameters<typeof ModelDropdown>[0],
  "models" | "loadingModels" | "value" | "onChange" | "open" | "onOpenChange"
>;

export function useProviderModelDropdown({
  onModelSelect,
  onRefreshModels,
  refreshingModelsFallback,
  modelOpen,
  setModelOpen,
  dropdownProps,
  modelDropdownProps,
}: {
  /** Unused by the hook itself; kept so both call sites can forward uniformly. */
  onModelSelect?: (resolvedId: string, rawId: string) => void;
  /** Site-side refresh used when no connection catalog is active. */
  onRefreshModels?: () => Promise<void>;
  /** Site-side refresh-in-flight flag used when no connection catalog is active. */
  refreshingModelsFallback?: boolean;
  modelOpen: boolean;
  setModelOpen: (open: boolean) => void;
  dropdownProps: ReturnType<typeof useProviderModelLinkage>["dropdownProps"];
  /** Site-supplied flags; the call sites always pass the required booleans. */
  modelDropdownProps?: ModelDropdownSiteProps;
}) {
  return {
    ...dropdownProps,
    onRefreshModels: dropdownProps.onRefreshModels ?? onRefreshModels,
    refreshingModels: dropdownProps.refreshingModels ?? refreshingModelsFallback,
    open: modelOpen,
    onOpenChange: setModelOpen,
    ...modelDropdownProps,
  } as Parameters<typeof ModelDropdown>[0];
}

export interface ProviderModelLinkageModelSelectProps
  extends ProviderModelLinkageSharedProps {
  modelValue: string;
  binding: AiRuntimeConnectionBinding | undefined;
  fallbackModels: AdapterModel[];
  fallbackModelsLoading?: boolean;
  providerBaseUrl?: string | null;
  onModelSelect: (resolvedId: string, rawId: string) => void;
  onRefreshModels?: () => Promise<void>;
  /** Site-side refresh-in-flight flag used when no connection catalog is active. */
  refreshingModelsFallback?: boolean;
  modelDropdownProps?: ModelDropdownSiteProps;
  /** Hide the dropdown entirely (call-site gates); renders only the notices. */
  hideModelSide?: boolean;
  /** Render the connection-catalog error line (suppressed when the call site renders its own chain). */
  suppressModelError?: boolean;
  /** Render the auto-rebind notice (suppressed when the call site renders its own). */
  suppressRebindNotice?: boolean;
}

/**
 * Model side in the stacked Harness/Runtime layout: the dropdown, then the
 * shared notices. DOM order matches the previous inline implementation.
 */
export function ProviderModelLinkageModelSelect({
  companyId,
  harness,
  linkageDisabled,
  onAutoRebind,
  modelValue,
  binding,
  fallbackModels,
  fallbackModelsLoading,
  providerBaseUrl,
  onModelSelect,
  onRefreshModels,
  refreshingModelsFallback,
  modelDropdownProps,
  hideModelSide,
  suppressModelError,
  suppressRebindNotice,
}: ProviderModelLinkageModelSelectProps) {
  const [modelOpen, setModelOpen] = useState(false);
  // Same narrowing AgentConfigForm applies: a router binding names a pool, not
  // an individual account catalog, so the model side treats it as "no catalog".
  const modelBinding = aiConnectionBindingSchema.safeParse(binding).data;
  const linkage = useProviderModelLinkage({
    companyId,
    harness,
    linkageDisabled,
    onAutoRebind,
    onModelSelect,
    modelValue,
    binding: modelBinding,
    fallbackModels,
    fallbackModelsLoading,
    providerBaseUrl,
  });
  const dropdown = useProviderModelDropdown({
    onModelSelect,
    onRefreshModels,
    refreshingModelsFallback,
    modelOpen,
    setModelOpen,
    dropdownProps: linkage.dropdownProps,
    modelDropdownProps,
  });
  return (
    <>
      {!hideModelSide && <ModelDropdown {...dropdown} />}
      {!suppressModelError && linkage.connectionModelError ? (
        <p className="text-xs text-destructive">{describeError(linkage.connectionModelError).body}</p>
      ) : null}
      {!suppressRebindNotice && linkage.autoReboundConnection && (
        <p className="text-xs text-muted-foreground">
          Switched the AI connection to “{linkage.autoReboundConnection}” so the selected model is served by its catalog.
        </p>
      )}
    </>
  );
}

export interface ProviderModelLinkageConnectionProps {
  companyId: string;
  agentId?: string;
  agentName: string;
  harness: string;
  /** True harness adapter when `harness` is a routed alias (pool compat). */
  routerAdapterType?: string;
  environmentId?: string;
  binding: AiRuntimeConnectionBinding | undefined;
  onBindingChange: (binding: AiRuntimeConnectionBinding) => void;
  onBindingClear?: () => void;
  /** Edit-mode legacy adoption flow (AgentConfigForm). */
  legacy?: boolean;
  /** Collapse the connection field under an "Advanced: Connect a provider account" disclosure. */
  advancedConnection?: boolean;
  /** Rendered inside the disclosure, between the summary and the field (e.g. the hermes host-default hint). */
  connectionDetailsExtra?: ReactNode;
  wizardPresets?: {
    provider?: "openrouter" | "bedrock" | "gateway" | "local" | "google" | "openai" | "anthropic" | "xai";
    protocol?: "chat" | "responses" | "messages";
    baseUrl?: string;
  };
  /** Current model id; sharpens the compat alert inside AiConnectionField. */
  model?: string;
  /**
   * When set, render the "existing connections but none compatible" reason
   * under the field for an unbound agent. Off by default; the create screen
   * enables it (AMB-311 UX item 3).
   */
  showCompatibilityHint?: boolean;
}

export function ProviderModelLinkageConnection({
  companyId,
  agentId,
  agentName,
  harness,
  routerAdapterType,
  environmentId,
  binding,
  onBindingChange,
  onBindingClear,
  legacy,
  advancedConnection,
  connectionDetailsExtra,
  wizardPresets,
  model,
  showCompatibilityHint,
}: ProviderModelLinkageConnectionProps) {
  const accounts = useQuery({
    queryKey: ["ai-connections-compat-hint", companyId, agentId],
    queryFn: () => aiConnectionsApi.list(companyId, agentId),
    enabled: Boolean(showCompatibilityHint && !binding),
    retry: false,
  });
  const connections = accounts.data?.connections ?? [];
  const noCompatibleConnection =
    showCompatibilityHint &&
    !binding &&
    accounts.isSuccess &&
    connections.length > 0 &&
    !connections.some((connection) => isAiConnectionCompatible(connection, harness, model));
  const field = (
    <AiConnectionField
      companyId={companyId}
      agentId={agentId}
      agentName={agentName}
      adapterType={harness}
      routerAdapterType={routerAdapterType}
      value={binding}
      model={model}
      environmentId={environmentId}
      legacy={legacy}
      initialWizardProvider={wizardPresets?.provider}
      initialWizardProtocol={wizardPresets?.protocol}
      initialWizardBaseUrl={wizardPresets?.baseUrl}
      onChange={onBindingChange}
      onClear={onBindingClear}
    />
  );
  return (
    <div className="space-y-3">
      {advancedConnection ? (
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Advanced: Connect a provider account
          </summary>
          {connectionDetailsExtra}
          {field}
        </details>
      ) : (
        field
      )}
      {noCompatibleConnection && (
        <p className="text-xs text-muted-foreground">
          This organization has managed connections, but none is compatible with
          this harness. Supported here: OpenRouter routed connections, or
          OpenAI/Anthropic/Google API-key accounts.
        </p>
      )}
    </div>
  );
}

export interface ProviderModelLinkageSelectProps {
  // connection side
  companyId: string;
  agentId?: string;
  agentName: string;
  harness: string;
  routerAdapterType?: string;
  environmentId?: string;
  binding: AiRuntimeConnectionBinding | undefined;
  onBindingChange: (binding: AiRuntimeConnectionBinding) => void;
  onBindingClear?: () => void;
  advancedConnection?: boolean;
  connectionDetailsExtra?: ReactNode;
  wizardPresets?: ProviderModelLinkageConnectionProps["wizardPresets"];
  showCompatibilityHint?: boolean;
  // model side
  modelValue: string;
  fallbackModels: AdapterModel[];
  fallbackModelsLoading?: boolean;
  hideModelSide?: boolean;
  onModelSelect: (resolvedId: string, rawId: string) => void;
  onRefreshModels?: () => Promise<void>;
  refreshingModelsFallback?: boolean;
  modelDropdownProps?: ModelDropdownSiteProps;
  linkageDisabled?: boolean;
  providerBaseUrl?: string | null;
  onAutoRebind: (connectionName: string, binding: AiConnectionBinding) => void;
  /** Extra content rendered beside the dropdown in the two-column grid (e.g. thinking effort). */
  modelSideExtra?: ReactNode;
  /** The call-site fallback-chain model error, rendered above the grid (create-screen parity). */
  fallbackModelError?: unknown;
}

/**
 * Composite for the adjacent create-agent layout: the shared model-error line
 * above the grid, the connection field, the model/effort grid, then the
 * auto-rebind notice — matching the previous inline DOM order.
 */
export function ProviderModelLinkageSelect({
  // connection side
  companyId,
  agentId,
  agentName,
  harness,
  routerAdapterType,
  environmentId,
  binding,
  onBindingChange,
  onBindingClear,
  advancedConnection,
  connectionDetailsExtra,
  wizardPresets,
  showCompatibilityHint,
  // model side
  modelValue,
  fallbackModels,
  fallbackModelsLoading,
  hideModelSide,
  onModelSelect,
  onRefreshModels,
  refreshingModelsFallback,
  modelSideExtra,
  modelDropdownProps,
  linkageDisabled,
  providerBaseUrl,
  onAutoRebind,
  fallbackModelError,
}: ProviderModelLinkageSelectProps) {
  const [modelOpen, setModelOpen] = useState(false);
  // Same narrowing AgentConfigForm applies (see ProviderModelLinkageModelSelect).
  const modelBinding = aiConnectionBindingSchema.safeParse(binding).data;
  const linkage = useProviderModelLinkage({
    companyId,
    harness,
    linkageDisabled,
    onAutoRebind,
    onModelSelect,
    modelValue,
    binding: modelBinding,
    fallbackModels,
    fallbackModelsLoading,
    providerBaseUrl,
  });
  const dropdown = useProviderModelDropdown({
    onModelSelect,
    onRefreshModels,
    refreshingModelsFallback,
    modelOpen,
    setModelOpen,
    dropdownProps: linkage.dropdownProps,
    modelDropdownProps,
  });
  const modelError = linkage.connectionModelError ?? fallbackModelError;
  return (
    <>
      {modelError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load models. Retry or enter a model ID manually.
        </p>
      ) : null}
      <ProviderModelLinkageConnection
        companyId={companyId!}
        agentId={agentId}
        agentName={agentName}
        harness={harness}
        routerAdapterType={routerAdapterType}
        environmentId={environmentId}
        binding={binding}
        onBindingChange={onBindingChange}
        onBindingClear={onBindingClear}
        advancedConnection={advancedConnection}
        connectionDetailsExtra={connectionDetailsExtra}
        wizardPresets={wizardPresets}
        model={modelValue}
        showCompatibilityHint={showCompatibilityHint}
      />
      {(!hideModelSide || modelSideExtra) && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {!hideModelSide && <ModelDropdown {...dropdown} />}
          {modelSideExtra}
        </div>
      )}
      {linkage.autoReboundConnection && (
        <p className="text-xs text-muted-foreground">
          Switched the AI connection to “{linkage.autoReboundConnection}” so the selected model is served by its catalog.
        </p>
      )}
    </>
  );
}
