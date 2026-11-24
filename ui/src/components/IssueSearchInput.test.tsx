// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { IssueSearchInput } from "./IssueSearchInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
const DEBOUNCE_MS = 250;

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

function keydown(input: HTMLInputElement, overrides: { key: string; isComposing?: boolean; keyCode?: number; timeStamp?: number }) {
  act(() => {
    const event = new KeyboardEvent("keydown", {
      key: overrides.key,
      bubbles: true,
    });
    Object.defineProperty(event, "keyCode", { value: overrides.keyCode });
    if (overrides.timeStamp !== undefined) {
      Object.defineProperty(event, "timeStamp", { value: overrides.timeStamp });
    }
    input.dispatchEvent(event);
  });
}

describe("IssueSearchInput", () => {
  let harness: ReturnType<typeof createTestHarness>;
  let onDebouncedChange: Mock<(search: string) => void>;
  let input: HTMLInputElement;

  const mount = (initialValue = "") =>
    harness.render(<IssueSearchInput value={initialValue} onDebouncedChange={onDebouncedChange} />);

  const setInputFromDom = () => {
    input = harness.container.querySelector('input[aria-label="Search tasks"]') as HTMLInputElement;
    expect(input).not.toBeNull();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createTestHarness();
    onDebouncedChange = vi.fn((_search: string) => undefined);
  });

  afterEach(() => {
    harness.unmount();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("commits the debounced draft after typing settles", async () => {
    mount();
    setInputFromDom();
    dispatchValue(input, "abc");
    expect(onDebouncedChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("abc");
  });

  it("waits for an IME composition to end before committing the draft", async () => {
    mount();
    setInputFromDom();
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    dispatchValue(input, "nihao");
    // Candidate browsing pause mid-composition: still composing.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 4);
    });
    expect(onDebouncedChange).not.toHaveBeenCalled();
    dispatchValue(input, "你好");
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("你好");
    expect(input.value).toBe("你好");
  });

  it("keeps an in-progress IME composition when a stale parent value arrives", async () => {
    mount();
    setInputFromDom();
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    dispatchValue(input, "niha");
    // A stale parent/URL value echoed from an earlier round-trip while the
    // composition is still active must not rewrite the field.
    harness.render(<IssueSearchInput value="ni" onDebouncedChange={onDebouncedChange} />);
    expect(input.value).toBe("niha");

    dispatchValue(input, "你好");
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(input.value).toBe("你好");
    expect(onDebouncedChange).toHaveBeenLastCalledWith("你好");
  });

  it("consumes its own debounced echo and keeps newer keystrokes", async () => {
    mount();
    setInputFromDom();
    dispatchValue(input, "ab");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(onDebouncedChange).toHaveBeenLastCalledWith("ab");
    // The "ab" echo lands after "c" was typed; the draft must win.
    dispatchValue(input, "abc");
    harness.render(<IssueSearchInput value="ab" onDebouncedChange={onDebouncedChange} />);
    expect(input.value).toBe("abc");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(onDebouncedChange).toHaveBeenLastCalledWith("abc");
    expect(input.value).toBe("abc");
  });

  it("adopts an external value change once the draft has settled", async () => {
    mount();
    setInputFromDom();
    harness.render(<IssueSearchInput value="cleared" onDebouncedChange={onDebouncedChange} />);
    // Effect-cascaded updates flush after the render pass.
    for (let attempt = 0; attempt < 4 && input.value !== "cleared"; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(0);
        await Promise.resolve();
      });
    }
    expect(input.value).toBe("cleared");
  });

  it("does not blur on the IME commit Enter reported outside an active composition", () => {
    mount();
    setInputFromDom();
    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    dispatchValue(input, "你好");
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    // Safari/broken-Chromium ordering: the Enter that committed the candidate
    // arrives after compositionend with isComposing=false and keyCode 229.
    keydown(input, { key: "Enter", keyCode: 229 });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("你好");
  });

  it("does not blur on an Enter inside the composition-end grace window", () => {
    mount();
    setInputFromDom();
    input.focus();
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    dispatchValue(input, "你好");
    act(() => {
      const compositionEnd = new CompositionEvent("compositionend", { bubbles: true });
      Object.defineProperty(compositionEnd, "timeStamp", { value: 1000, configurable: true });
      input.dispatchEvent(compositionEnd);
    });
    // Engines reorder the commit Enter to just after compositionend; the grace
    // window must swallow it even when keyCode does not identify the IME.
    keydown(input, { key: "Enter", timeStamp: 1005 });
    expect(document.activeElement).toBe(input);
    // Much later, a real Enter blurs as before.
    keydown(input, { key: "Enter", timeStamp: 2000 });
    expect(document.activeElement).not.toBe(input);
  });

  it("blurs on a plain Enter press", () => {
    mount();
    setInputFromDom();
    input.focus();
    expect(document.activeElement).toBe(input);
    keydown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
  });

  it("blurs on Escape only when the field is empty and no composition is involved", () => {
    mount();
    setInputFromDom();
    input.focus();
    keydown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);

    mount();
    setInputFromDom();
    input.focus();
    dispatchValue(input, "query");
    keydown(input, { key: "Escape" });
    expect(document.activeElement).toBe(input);
  });
});
