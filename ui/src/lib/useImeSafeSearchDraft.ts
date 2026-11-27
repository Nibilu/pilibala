import { useEffect, useRef, useState } from "react";

/**
 * Draft-first search-field state that is safe against async parent values
 * (URL params, stores) and against IME composition.
 *
 * The draft in the user's hands is authoritative while they type: parent
 * `value` updates that echo this hook's own commits are consumed (never
 * re-applied), external `value` changes are adopted only when the draft has
 * settled, and nothing rewrites an active IME composition. Rewriting a
 * controlled field mid-composition makes engines restart the composition from
 * the rewritten base, which duplicates the typed text on every composition
 * update — the failure behind doubled task-list search input (AMB-384).
 *
 * `debounceMs: 0` (default) commits synchronously inside the change event,
 * preserving exact existing behavior for callers that pass plain state.
 * Callers whose commit crosses an async boundary (URL/router writes, server
 * search) pass a debounce window so the parent value can settle between
 * commits.
 */
export function useImeSafeSearchDraft({
  value,
  onCommit,
  debounceMs = 0,
}: {
  value: string;
  onCommit?: (value: string) => void;
  debounceMs?: number;
}): {
  draftValue: string;
  /** Change-event handler for the controlled input. */
  handleInputChange: (event: { target: { value: string } }) => void;
  /** Programmatic set + immediate commit (clear affordances, resets). */
  commitValue: (next: string) => void;
  isComposing: boolean;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
} {
  const [draftValue, setDraftValue] = useState(value);
  const [isComposing, setIsComposing] = useState(false);
  /** Last parent value the draft and the parent agreed on. */
  const lastSyncedValueRef = useRef(value);
  /** Values this hook committed whose parent echo has not landed yet. */
  const pendingEchoRef = useRef<Set<string>>(new Set());
  const draftValueRef = useRef(draftValue);
  draftValueRef.current = draftValue;
  const isComposingRef = useRef(isComposing);
  isComposingRef.current = isComposing;
  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  /** A value seen and ignored during a composition: stale by definition. */
  const staleWhileComposingRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (value === lastSyncedValueRef.current) return;
    // Our own commit echoing back: consume it and leave the draft alone.
    // Under load the echo can arrive after further keystrokes, and
    // re-applying it would revert live typing (and destroy an in-progress
    // IME composition in real browsers).
    if (pendingEchoRef.current.delete(value)) return;
    if (isComposing) {
      // Any parent value observed mid-composition predates the composition
      // text. Record it so the post-composition effect run cannot mistake it
      // for a fresh external change and clobber the settled draft (the
      // lagging URL write in AMB-384 did exactly that).
      staleWhileComposingRef.current = value;
      return;
    }
    if (value === staleWhileComposingRef.current) {
      staleWhileComposingRef.current = undefined;
      return;
    }
    // External change (clear-filters, back navigation, …). Adopt it only once
    // the draft has settled; otherwise the user's live typing wins and the
    // parent re-syncs from the next commit.
    if (draftValueRef.current !== lastSyncedValueRef.current) return;
    setDraftValue(value);
    lastSyncedValueRef.current = value;
    pendingEchoRef.current.clear();
  }, [value, isComposing]);

  useEffect(() => {
    if (!debounceMs || !onCommit || isComposing) return;
    if (draftValue === lastSyncedValueRef.current) return;

    const timeoutId = window.setTimeout(() => {
      lastSyncedValueRef.current = draftValue;
      pendingEchoRef.current.add(draftValue);
      onCommitRef.current?.(draftValue);
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [draftValue, debounceMs, isComposing, onCommit]);

  const commitNow = (next: string) => {
    // Never rewrite the field out from under an active IME composition — a
    // programmatic clear during composition would restart it from the
    // rewritten base and duplicate text. The draft updates; the commit lands
    // once the composition has ended (see handleCompositionEnd).
    if (isComposingRef.current) {
      setDraftValue(next);
      return;
    }
    lastSyncedValueRef.current = next;
    pendingEchoRef.current.add(next);
    setDraftValue(next);
    onCommitRef.current?.(next);
  };

  const handleInputChange = (event: { target: { value: string } }) => {
    const next = event.target.value;
    if (debounceMs > 0) {
      setDraftValue(next);
      return;
    }
    commitNow(next);
  };

  return {
    draftValue,
    handleInputChange,
    commitValue: commitNow,
    isComposing,
    handleCompositionStart: () => {
      setIsComposing(true);
    },
    handleCompositionEnd: () => {
      setIsComposing(false);
      isComposingRef.current = false;
      // Synchronous-commit fields skipped every commit made while the
      // composition was active; flush the settled draft now. Debounced
      // fields reschedule through the effect below (isComposing changed).
      if (!debounceMsRef.current && draftValueRef.current !== lastSyncedValueRef.current) {
        lastSyncedValueRef.current = draftValueRef.current;
        pendingEchoRef.current.add(draftValueRef.current);
        onCommitRef.current?.(draftValueRef.current);
      }
    },
  };
}
