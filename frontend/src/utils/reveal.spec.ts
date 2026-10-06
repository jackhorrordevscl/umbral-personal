import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealElement } from './reveal';

describe('revealElement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing and does not throw for null', () => {
    expect(() => revealElement(null)).not.toThrow();
  });

  it('does not throw when the element has no scrollIntoView (jsdom)', () => {
    const el = document.createElement('div');
    // jsdom does not implement scrollIntoView.
    expect((el as Partial<HTMLElement>).scrollIntoView).toBeUndefined();
    expect(() => revealElement(el)).not.toThrow();
  });

  it('scrolls smoothly to the nearest edge', () => {
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));

    revealElement(el);

    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
    });
  });

  it('uses auto behavior when the user prefers reduced motion', () => {
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);

    revealElement(el);

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
    });
  });

  it('does not throw and still scrolls when matchMedia is unavailable', () => {
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', undefined);

    expect(() => revealElement(el)).not.toThrow();
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
    });
  });
});
