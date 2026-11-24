import { startTransition, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { shouldBlurPageSearchOnEnter, shouldBlurPageSearchOnEscape } from "@/lib/keyboardShortcuts";

const ISSUE_SEARCH_DEBOUNCE_MS = 250;

/**
 * Draft-first search field with IME-safe sync semantics.
 *
 * The draft in the user's hands is authoritative while they type: parent
 * `value` updates that echo this component's own debounced commits are
 * consumed (never re-applied), external `value` changes are adopted only when
 * the draft has settled, and nothing rewrites an active IME composition.
 *
 * Keystrokes that belong to an IME composition never blur the field either.
 * Safari and some Chromium builds deliver the composition-confirming
 * keydown only after compositionend (with `isComposing: false` and keyCode
 * 229), so the blur decision is routed through the composition-aware
 * keyboard-shortcut guards.
 */
export function IssueSearchInput({
  value,
  onDebouncedChange,
  containerClassName,
}: {
  value: string;
  onDebouncedChange?: (search: string) => void;
  containerClassName?: string;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const [isComposing, setIsComposing] = useState(false);
  /** Last parent/URL value the draft and the parent agreed on. */
  const lastSyncedValueRef = useRef(value);
  /** Values this component committed whose parent echo has not landed yet. */
  const pendingEchoRef = useRef<Set<string>>(new Set());
  const draftValueRef = useRef(draftValue);
  draftValueRef.current = draftValue;
  /** Event timestamp of the most recent compositionend on the field. */
  const compositionEndedAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value === lastSyncedValueRef.current) return;
    // Our own debounced commit echoing back: consume it and leave the draft
    // alone. Under load the echo can arrive after further keystrokes, and
    // re-applying it would revert live typing (and destroy an in-progress
    // IME composition in real browsers).
    if (pendingEchoRef.current.delete(value)) return;
    if (isComposing) return;
    // External change (clear-filters, back navigation, …). Adopt it only once
    // the draft has settled; otherwise the user's live typing wins and the
    // parent re-syncs from the next debounced commit.
    if (draftValueRef.current !== lastSyncedValueRef.current) return;
    setDraftValue(value);
    lastSyncedValueRef.current = value;
    pendingEchoRef.current.clear();
  }, [value, isComposing]);

  useEffect(() => {
    if (!onDebouncedChange || isComposing) return;
    if (draftValue === lastSyncedValueRef.current) return;

    const timeoutId = window.setTimeout(() => {
      lastSyncedValueRef.current = draftValue;
      pendingEchoRef.current.add(draftValue);
      startTransition(() => {
        onDebouncedChange(draftValue);
      });
    }, ISSUE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [draftValue, onDebouncedChange, isComposing]);

  return (
    <div className={containerClassName ?? "relative w-full sm:w-64 md:w-80"}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={draftValue}
        onChange={(e) => {
          setDraftValue(e.target.value);
        }}
        onCompositionStart={() => {
          setIsComposing(true);
        }}
        onCompositionEnd={(e) => {
          compositionEndedAtRef.current = e.nativeEvent.timeStamp;
          setIsComposing(false);
        }}
        onKeyDown={(e) => {
          if (
            shouldBlurPageSearchOnEnter({
              key: e.key,
              isComposing: e.nativeEvent.isComposing,
              keyCode: e.nativeEvent.keyCode,
              compositionEndedAt: compositionEndedAtRef.current,
              timeStamp: e.nativeEvent.timeStamp,
            })
          ) {
            e.currentTarget.blur();
            return;
          }

          if (
            shouldBlurPageSearchOnEscape({
              key: e.key,
              isComposing: e.nativeEvent.isComposing,
              currentValue: e.currentTarget.value,
              keyCode: e.nativeEvent.keyCode,
              compositionEndedAt: compositionEndedAtRef.current,
              timeStamp: e.nativeEvent.timeStamp,
            })
          ) {
            e.currentTarget.blur();
          }
        }}
        placeholder="Search tasks..."
        className="pl-7 text-xs sm:text-sm"
        aria-label="Search tasks"
        data-page-search-target="true"
      />
    </div>
  );
}
