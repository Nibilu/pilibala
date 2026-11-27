import type { Ref } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useImeSafeSearchDraft } from "@/lib/useImeSafeSearchDraft";

/** Shared collection search field: one surface, focus ring and clear affordance. */
export function ToolbarSearch({ query, onQueryChange, label, placeholder, clearLabel = "Clear search", inputRef, inputType = "text", debounceMs = 0 }: {
  query: string;
  onQueryChange: (value: string) => void;
  label: string;
  placeholder: string;
  clearLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputType?: "text" | "search";
  /**
   * Debounce window before handing the settled draft to `onQueryChange`.
   * Surfaces whose commit crosses an async boundary (URL/router writes,
   * server search) pass a window so the parent value can settle between
   * commits; 0 (default) commits synchronously on every change.
   */
  debounceMs?: number;
}) {
  // The draft lives here so a lagging parent value (URL params, router
  // transitions) can never rewrite the field under the user's hands — that
  // rewrite is what duplicated IME input in the task list search (AMB-384).
  const { draftValue, handleInputChange, commitValue, handleCompositionStart, handleCompositionEnd } =
    useImeSafeSearchDraft({ value: query, onCommit: onQueryChange, debounceMs });
  return <div className="design-task-search" data-toolbar-search>
    <Search aria-hidden />
    <Input
      ref={inputRef}
      type={inputType}
      aria-label={label}
      placeholder={placeholder}
      value={draftValue}
      onChange={handleInputChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
    {draftValue && <Button variant="ghost" size="icon-xs" data-toolbar-clear aria-label={clearLabel} onClick={() => commitValue("")}><X aria-hidden /></Button>}
  </div>;
}
