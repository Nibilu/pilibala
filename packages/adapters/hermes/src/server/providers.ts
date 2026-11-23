/**
 * Hermes provider and model discovery for Pilibala setup UX.
 *
 * Two sources, both read-only against the host Hermes installation:
 *
 * 1. Provider list — the installed Hermes `providers` package registry
 *    (plugins/model-providers/*), enumerated through the Hermes venv's Python.
 *    Each entry carries name, base URL, credential env vars, and fallback
 *    models. This is what the UI shows as the "Model provider" options.
 *    User-defined gateways from config.yaml `custom_providers` are merged in:
 *    `key_env` supplies the credential env var and the cached `models` map
 *    becomes the fallback list (inline `api_key` values are never read).
 *
 * 2. Live model list — when a provider exposes an OpenAI-compatible
 *    /v1/models endpoint and a credential exists in ~/.hermes/.env (or the
 *    environment), fetch it. Providers without a key fall back to the
 *    registry's fallback_models. Discovery failures never throw: they
 *    degrade to the fallback list with a `discovered: false` marker.
 *
 * Results are cached briefly (60s) because the provider registry import is
 * not free and setup screens re-render.
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export interface HermesProviderEntry {
  name: string;
  baseUrl: string;
  envVars: string[];
  fallbackModels: string[];
  /**
   * Where the entry came from. "registry" = an installed Hermes provider
   * plugin (its name is a `_KNOWN_PROVIDER_NAMES` member, so the CLI/ACP
   * `provider:model` colon form decodes it). "custom" = a user-defined
   * gateway from config.yaml `custom_providers` — Hermes only decodes those
   * through the `custom:<name>:<model>` form (hermes_cli
   * `_configured_custom_provider_ids`), never `<name>:<model>`. Transport
   * qualification (acp.ts) keys on this.
   */
  origin: "registry" | "custom";
  /**
   * Routable Hermes identity for custom gateways only (`custom:<key-or-name>`,
   * per hermes_cli `custom_provider_slug`): keyed `providers:` entries use
   * their config key, legacy `custom_providers:` entries use the normalized
   * display name. The transport qualification (acp.ts) must anchor the model
   * to THIS id — `<name>:<model>` is not decodable for custom gateways.
   */
  customIdentity?: string;
}

export interface HermesModelListResult {
  provider: string;
  models: string[];
  /** True when the list came from a live /v1/models fetch. */
  discovered: boolean;
  /** Present when discovery degraded (no credential, endpoint error, timeout). */
  reason?: string;
}

const CACHE_TTL_MS = 60_000;
let providerCache: { at: number; entries: HermesProviderEntry[] } | null = null;
const modelCache = new Map<string, { at: number; result: HermesModelListResult }>();

/** Discovery must never hang setup: cap both the Python registry read and each HTTP fetch. */
const REGISTRY_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 12_000;

/** Providers whose registry entries already represent user config, not a real upstream. */
const NON_UPSTREAM_PROVIDERS = new Set([
  "custom",
  "auto",
  "router",
  "ollama-cloud",
]);

/** Prefer the Hermes venv interpreter; fall back to `python3` on PATH. */
function hermesPythonCandidates(): string[] {
  const home = process.env.HERMES_HOME
    ? pathResolve(process.env.HERMES_HOME, "..", "hermes-agent")
    : join(homedir(), ".hermes", "hermes-agent");
  return [
    join(home, "venv", "bin", "python3"),
    join(home, ".venv", "bin", "python3"),
    "python3",
  ];
}

function pathResolve(...parts: string[]): string {
  // Local resolve so this module has no node:path import weight beyond need.
  const joined = parts.reduce(
    (acc, part) => (part.startsWith("/")
      ? part
      : acc ? `${acc}/${part}` : part),
    "",
  );
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** Run the registry enumeration inside Hermes's own interpreter. */
async function readProviderRegistry(): Promise<HermesProviderEntry[]> {
  const script = `
import json, sys
try:
    sys.path.insert(0, "/home/amber/.hermes/hermes-agent")
except Exception:
    pass
from providers import list_providers
out = []
for p in list_providers():
    name = getattr(p, "name", "") or ""
    if not name:
        continue
    out.append({
        "name": name,
        "baseUrl": getattr(p, "base_url", "") or "",
        "envVars": [v for v in (getattr(p, "env_vars", ()) or ()) if isinstance(v, str)],
        "fallbackModels": [m for m in (getattr(p, "fallback_models", ()) or ()) if isinstance(m, str)],
        "origin": "registry",
    })
def _pilibala_custom_blocks_fallback(path):
    """No yaml module available (the Hermes interpreter sometimes ships
    without PyYAML/ruamel): a targeted indentation reader for just the two
    user-defined gateway layouts — the 'custom_providers' list and the
    'providers' mapping. Handles plain/quoted scalars, '#' comments, and
    one nested 'models' level (mapping or list), reduced to model ids.
    Unparseable lines are skipped — the merge degrades to fewer entries,
    never a failure."""
    custom_providers = []
    providers = {}
    mode = None
    entry = None
    entry_indent = -1
    field = None
    field_indent = -1
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read().replace("\\uFEFF", "").split("\\n")
    except Exception:
        return {"custom_providers": custom_providers, "providers": providers}
    for line in raw:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0 and not (mode is not None and stripped.startswith("- ")):
            # A "- " item at the parent key's own indent is legal YAML (block
            # sequence at the same level as its key) — it belongs to the
            # current block, not a new top-level section.
            head = stripped.split(":", 1)[0].strip()
            mode = head if (stripped.endswith(":") and head in ("custom_providers", "providers")) else None
            entry, entry_indent, field, field_indent = None, -1, None, -1
            continue
        if mode is None:
            continue
        if field is not None and indent > field_indent and entry is not None:
            # Nested keys under the 'models' mapping (or list items) — only
            # the model ids matter; normalize both shapes to a list.
            if field == "models":
                item = stripped[2:].strip() if stripped.startswith("- ") else stripped.split(":", 1)[0].strip()
                if item:
                    entry.setdefault("models", []).append(item.strip("'\\\" "))
            continue
        if field is not None and indent <= field_indent:
            field, field_indent = None, -1
        if stripped.startswith("- ") and (entry is None or indent <= entry_indent):
            entry = {}
            entry_indent = indent
            if mode == "custom_providers":
                custom_providers.append(entry)
            stripped = stripped[2:].strip()
            if not stripped or ":" not in stripped:
                entry = None
                continue
        if ":" not in stripped:
            continue
        key = stripped.split(":", 1)[0].strip()
        value = stripped.split(":", 1)[1]
        if mode == "providers" and entry is None and stripped.endswith(":"):
            entry = {}
            entry_indent = indent
            providers[key] = entry
            continue
        if entry is None:
            continue
        if value.strip() == "" or value.strip().startswith("#"):
            field, field_indent = key, indent
            if key == "models":
                entry.setdefault("models", [])
            continue
        val = value.split(" #", 1)[0].strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        entry[key] = val
    return {"custom_providers": custom_providers, "providers": providers}

cfg = None
try:
    import yaml
    with open("/home/amber/.hermes/config.yaml", "r", encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle) or {}
except Exception as exc:
    sys.stderr.write("[pilibala-providers] yaml unavailable (%s); using the targeted fallback reader\\n" % exc)
    cfg = None
if cfg is None:
    cfg = _pilibala_custom_blocks_fallback("/home/amber/.hermes/config.yaml")
if not isinstance(cfg, dict):
    cfg = {}
try:
    known = {e["name"].lower() for e in out}
    for cp in (cfg.get("custom_providers") or []):
        if not isinstance(cp, dict):
            continue
        cname = str(cp.get("name") or "").strip()
        cbase = str(cp.get("base_url") or "").strip()
        if not cname or not cbase or cname.lower() in known:
            continue
        raw_models = cp.get("models")
        cmodels = [str(m) for m in (raw_models.keys() if isinstance(raw_models, dict) else (raw_models or []))]
        out.append({
            "name": cname,
            "baseUrl": cbase,
            "envVars": [str(cp["key_env"])] if cp.get("key_env") else [],
            "fallbackModels": cmodels,
            "origin": "custom",
            "customIdentity": "custom:" + cname.lower().replace(" ", "-"),
        })
        known.add(cname.lower())
    # The modern 'providers:' dict block is the second user-defined layout
    # Hermes routes (hermes_cli _configured_custom_provider_ids reads both).
    # Keyed entries take their config key as the routable identity
    # (custom_provider_slug: "keyed providers: entries use their config key"),
    # so the identity can differ from the display name.
    for pkey, pentry in ((cfg.get("providers") or {}).items()
                         if isinstance(cfg.get("providers"), dict) else []):
        if not isinstance(pentry, dict):
            continue
        pname = str(pentry.get("name") or pkey).strip()
        pbase = str(pentry.get("base_url") or "").strip()
        if not pname or not pbase or pname.lower() in known:
            continue
        raw_models = pentry.get("models")
        pmodels = [str(m) for m in (raw_models.keys() if isinstance(raw_models, dict) else (raw_models or []))]
        out.append({
            "name": pname,
            "baseUrl": pbase,
            "envVars": [str(pentry["key_env"])] if pentry.get("key_env") else [],
            "fallbackModels": pmodels,
            "origin": "custom",
            "customIdentity": "custom:" + str(pkey or pname).strip().lower().replace(" ", "-"),
        })
        known.add(pname.lower())
except Exception as exc:
    sys.stderr.write("[pilibala-providers] custom-provider merge failed: %s\\n" % exc)
print(json.dumps(out))
`;
  let lastError: unknown = null;
  for (const python of hermesPythonCandidates()) {
    try {
      const { stdout } = await execFileAsync(python, ["-c", script], {
        timeout: REGISTRY_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout.trim()) as HermesProviderEntry[];
      return parsed.filter((entry) => !NON_UPSTREAM_PROVIDERS.has(entry.name));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("provider registry unavailable");
}

/** Read credentials from ~/.hermes/.env (secrets only — never returned to the UI). */
async function readHermesEnv(): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const envPath of [join(homedir(), ".hermes", ".env")]) {
    let content: string;
    try {
      content = await readFile(envPath, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value && !values[key]) values[key] = value;
    }
  }
  return values;
}

function authHeaderFor(entry: HermesProviderEntry, hermesEnv: Record<string, string>): string | null {
  const base = entry.baseUrl.trim();
  // Anthropic-style providers use x-api-key; everything Hermes lists on an
  // OpenAI-compatible base URL takes a bearer token.
  const key = entry.envVars
    .map((name) => process.env[name] ?? hermesEnv[name])
    .find((value) => typeof value === "string" && value.length > 0);
  if (!key) return null;
  if (base.includes("api.anthropic.com")) return `x-api-key: ${key}`;
  return `Bearer ${key}`;
}

/** Models endpoint candidates for a provider base URL. */
function modelsUrlFor(entry: HermesProviderEntry): string | null {
  const base = entry.baseUrl.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  // OpenAI-compatible base URLs already end at the version root.
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

export async function listHermesProviders(): Promise<HermesProviderEntry[]> {
  if (providerCache && Date.now() - providerCache.at < CACHE_TTL_MS) {
    return providerCache.entries;
  }
  const entries = await readProviderRegistry();
  providerCache = { at: Date.now(), entries };
  return entries;
}

export async function listHermesProviderModels(
  provider: string,
): Promise<HermesModelListResult> {
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const entries = await listHermesProviders();
  // Provider names arrive from two casings: the registry/config entry
  // (e.g. "Riceapis") and config.yaml's current-provider value (e.g.
  // "riceapis"). Match case-insensitively so both resolve to one entry.
  const wanted = provider.toLowerCase();
  const entry = entries.find((candidate) => candidate.name.toLowerCase() === wanted);
  const fallback: HermesModelListResult = {
    provider,
    models: entry?.fallbackModels ?? [],
    discovered: false,
    ...(entry ? {} : { reason: "unknown_provider" }),
  };
  if (!entry) {
    modelCache.set(provider, { at: Date.now(), result: fallback });
    return fallback;
  }

  const hermesEnv = await readHermesEnv();
  const auth = authHeaderFor(entry, hermesEnv);
  const url = modelsUrlFor(entry);
  if (!auth || !url) {
    const result: HermesModelListResult = {
      ...fallback,
      ...(auth ? {} : { reason: "no_credential" }),
    };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers: Record<string, string> =
      auth.startsWith("x-api-key:")
        ? { "x-api-key": auth.slice("x-api-key:".length).trim(), "anthropic-version": "2023-06-01" }
        : { Authorization: auth };
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const result: HermesModelListResult = {
        ...fallback,
        reason: `http_${response.status}`,
      };
      modelCache.set(provider, { at: Date.now(), result });
      return result;
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload.data ?? [])
      .map((model) => (typeof model?.id === "string" ? model.id : null))
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b));
    const result: HermesModelListResult = models.length
      ? { provider, models, discovered: true }
      : { ...fallback, reason: "empty_catalog" };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  } catch (error) {
    const result: HermesModelListResult = {
      ...fallback,
      reason: error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "endpoint_unreachable",
    };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook: drop caches so tests exercise fresh discovery. */
export function resetHermesDiscoveryCache(): void {
  providerCache = null;
  modelCache.clear();
}
