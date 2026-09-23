import { describe, it, expect, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { activateOnKey } from "./activate-on-key";

const keyEvent = (key: string) => {
  const preventDefault = vi.fn();
  return {
    event: { key, preventDefault } as unknown as KeyboardEvent<HTMLElement>,
    preventDefault,
  };
};

describe("activateOnKey", () => {
  it.each(["Enter", " "])("calls the handler and prevents default on %j", (key) => {
    const fn = vi.fn();
    const { event, preventDefault } = keyEvent(key);
    activateOnKey(fn)(event);
    expect(fn).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("ignores other keys", () => {
    const fn = vi.fn();
    const { event, preventDefault } = keyEvent("Tab");
    activateOnKey(fn)(event);
    expect(fn).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
