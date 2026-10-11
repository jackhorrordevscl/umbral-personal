import axe from 'axe-core'

// jsdom does not compute layout or real styles, so these rules would report
// false positives or false negatives:
// - color-contrast: needs computed colors and rendered geometry.
// - region: pages are rendered as fragments inside a test container, not as a
//   full document with landmarks around all content.
const JSDOM_UNRELIABLE_RULES = ['color-contrast', 'region']

function formatViolation(violation: axe.Result): string {
  const targets = violation.nodes
    .map((node) => `    - ${node.target.join(' ')}\n      ${node.html}`)
    .join('\n')
  return `[${violation.id}] (${violation.impact ?? 'unknown'}) ${violation.help}\n  ${violation.helpUrl}\n${targets}`
}

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: Object.fromEntries(
      JSDOM_UNRELIABLE_RULES.map((id) => [id, { enabled: false }]),
    ),
  })
  if (results.violations.length > 0) {
    throw new Error(
      `${results.violations.length} accessibility violation(s):\n${results.violations
        .map(formatViolation)
        .join('\n')}`,
    )
  }
}
