import AxeBuilder from '@axe-core/playwright';
import { test, type Page } from '@playwright/test';
import type { Result } from 'axe-core';

// axe runs here, in a real browser, to cover what the jsdom tests in
// src/test/axe.ts cannot: jsdom has no layout or computed colors, so that
// setup disables `color-contrast` and `region`. Here every rule of these
// WCAG tags stays enabled.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Waits for network quiet and for every running CSS animation/transition to
// finish, so axe never samples colors mid-fade (a false color-contrast result).
export async function waitForSettled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );
}

export async function scanA11y(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations;
}

export function formatViolations(label: string, violations: Result[]): string {
  const lines = violations.map((violation) => {
    const nodes = violation.nodes.map((node) => {
      const contrast = node.any.find((check) => check.id === 'color-contrast')?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string }
        | undefined;
      const colors = contrast
        ? ` [fg ${contrast.fgColor}, bg ${contrast.bgColor}, ratio ${contrast.contrastRatio}, expected ${contrast.expectedContrastRatio}]`
        : '';
      return `    - ${node.target.join(' ')}${colors}\n      ${node.html}`;
    });
    return [
      `  * ${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}`,
      `    ${violation.helpUrl}`,
      ...nodes,
    ].join('\n');
  });
  return `[a11y] ${label}: ${violations.length} violation(s)\n${lines.join('\n')}`;
}

// Fails with one entry per violation (rule, impact, help URL, selector and
// HTML). Call it only once the screen is settled (data loaded, no spinner,
// modal open, animations finished), otherwise axe may see a transient state.
//
// `knownViolations` marks a screen whose violations were found but are not
// fixed yet (the fix is a design decision, not a test concern). The scan is
// NOT asserted for it: the reason is recorded as a test annotation so it shows
// in the Playwright report. Remove the option once the app is fixed.
export async function expectNoA11yViolations(
  page: Page,
  { label, knownViolations }: { label: string; knownViolations?: string },
): Promise<void> {
  if (knownViolations) {
    test.info().annotations.push({ type: 'a11y-known-violation', description: `${label}: ${knownViolations}` });
    return;
  }
  await waitForSettled(page);
  const violations = await scanA11y(page);
  if (violations.length > 0) {
    throw new Error(formatViolations(label, violations));
  }
}
