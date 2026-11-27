import { startTransition, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { shouldBlurPageSearchOnEnter, shouldBlurPageSearchOnEscape } from "@/lib/keyboardShortcuts";
import { useImeSafeSearchDraft } from "@/lib/useImeSafeSearchDraft";

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
  const {
    draftValue,
    handleInputChange,
    handleCompositionStart,
    handleCompositionEnd,
  } = useImeSafeSearchDraft({
    value,
    onCommit: onDebouncedChange
      ? (next) => {
          startTransition(() => {
            onDebouncedChange(next);
          });
        }
      : undefined,
    debounceMs: ISSUE_SEARCH_DEBOUNCE_MS,
  });
  /** Event timestamp of the most recent compositionend on the field. */
  const compositionEndedAtRef = useRef<number | undefined>(undefined);

  return (
    <div className={containerClassName ?? "relative w-full sm:w-64 md:w-80"}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={draftValue}
        onChange={handleInputChange}
        onCompositionStart={() => {
          handleCompositionStart();
        }}
        onCompositionEnd={(e) => {
          compositionEndedAtRef.current = e.nativeEvent.timeStamp;
          handleCompositionEnd();
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
