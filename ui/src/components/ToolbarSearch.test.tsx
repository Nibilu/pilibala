// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarSearch } from "./ToolbarSearch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

function createTestHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (node: ReactNode | null) => {
    act(() => {
      root.render(node ?? null);
    });
  };
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  };
  return { container, root, render, unmount };
}

function dispatchValue(input: HTMLInputElement, value: string) {
  act(() => {
    if (!valueSetter) return;
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ToolbarSearch", () => {
  let harness: ReturnType<typeof createTestHarness>;
  let onQueryChange: ReturnType<typeof vi.fn<(value: string) => void>>;
  let input: HTMLInputElement;

  const mount = (query = "", debounceMs = 0) =>
    harness.render(<ToolbarSearch query={query} onQueryChange={onQueryChange} label="Search tasks" placeholder="Search tasks…" debounceMs={debounceMs} />);

  const setInputFromDom = () => {
    input = harness.container.querySelector("[data-toolbar-search] input") as HTMLInputElement;
    expect(input).not.toBeNull();
  };

  const flushEffectCascade = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(0);
        await Promise.resolve();
      });
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createTestHarness();
    onQueryChange = vi.fn((_value: string) => undefined);
  });

  afterEach(() => {
    harness.unmount();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("commits every keystroke synchronously by default", () => {
    mount();
    setInputFromDom();
    dispatchValue(input, "a");
    expect(onQueryChange).toHaveBeenLastCalledWith("a");
    dispatchValue(input, "ab");
    expect(onQueryChange).toHaveBeenLastCalledWith("ab");
    expect(input.value).toBe("ab");
  });

  it("with a debounce window, commits the settled draft once", async () => {
    mount("", 250);
    setInputFromDom();
    dispatchValue(input, "a");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(onQueryChange).not.toHaveBeenCalled();
    dispatchValue(input, "ab");
    await act(async () => {
      vi.advanceTimersByTime(249);
    });
    expect(onQueryChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith("ab");
    expect(input.value).toBe("ab");
  });

  it("keeps an in-progress IME composition when a lagging parent value arrives", async () => {
    // AMB-384 regression: the task list search value is URL-controlled, so
    // the parent echo of the previous composition update lags one commit
    // behind. Rewriting the field mid-composition makes browsers restart the
    // composition from the rewritten base and duplicate the typed text.
    mount();
    setInputFromDom();
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    dispatchValue(input, "ni");
    // The lagging URL write from the previous update lands mid-composition.
    mount("n");
    expect(input.value).toBe("ni");
    dispatchValue(input, "nihao");
    mount("ni");
    expect(input.value).toBe("nihao");
    // Candidate chosen: the composition becomes the committed text.
    dispatchValue(input, "你好");
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(input.value).toBe("你好");
    expect(onQueryChange).toHaveBeenLastCalledWith("你好");
  });

  it("consumes its own commit echo and keeps newer keystrokes", () => {
    mount();
    setInputFromDom();
    dispatchValue(input, "ab");
    expect(onQueryChange).toHaveBeenLastCalledWith("ab");
    // The "ab" echo lands after "c" was typed; the draft must win.
    dispatchValue(input, "abc");
    mount("ab");
    expect(input.value).toBe("abc");
    expect(onQueryChange).toHaveBeenLastCalledWith("abc");
  });

  it("adopts an external value once the draft has settled", async () => {
    mount();
    setInputFromDom();
    // Clear-filters / back navigation replaces the search wholesale.
    mount("cleared");
    await flushEffectCascade();
    expect(input.value).toBe("cleared");
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("keeps live typing when a lagging value lands inside the debounce window", async () => {
    mount("", 250);
    setInputFromDom();
    dispatchValue(input, "depl");
    // A stale URL value lands while the draft is still unsettled; the draft
    // wins and the settled commit then re-syncs the parent from it.
    mount("stale", 250);
    expect(input.value).toBe("depl");
    await act(async () => {
      vi.advanceTimersByTime(251);
    });
    expect(onQueryChange).toHaveBeenLastCalledWith("depl");
    expect(input.value).toBe("depl");
  });

  it("clear button clears the draft and commits immediately despite the debounce window", async () => {
    mount("", 250);
    setInputFromDom();
    dispatchValue(input, "abc");
    const clear = harness.container.querySelector("button[data-toolbar-clear]") as HTMLButtonElement | null;
    expect(clear).not.toBeNull();
    act(() => {
      clear!.click();
    });
    expect(input.value).toBe("");
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith("");
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // The pending debounced "abc" commit must not fire after the clear.
    expect(onQueryChange).toHaveBeenCalledTimes(1);
  });

  it("derives the clear affordance from the visible draft", () => {
    mount();
    setInputFromDom();
    expect(harness.container.querySelector("button[data-toolbar-clear]")).toBeNull();
    dispatchValue(input, "needle");
    expect(harness.container.querySelector("button[data-toolbar-clear]")).not.toBeNull();
  });
});
