import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SlotList from './SlotList';
import {
  buildLocalISO,
  formatChileLongDate,
  formatSlotTimeRange,
} from '../../utils/datetime';
import type { PublicSlot } from '../../api/publicScheduling';

const DAY = '2026-10-08';

function slot(from: string, to: string): PublicSlot {
  return { start: buildLocalISO(DAY, from), end: buildLocalISO(DAY, to) };
}

const SLOTS = [slot('10:00', '11:00'), slot('11:00', '12:00')];

function renderList(
  overrides: Partial<React.ComponentProps<typeof SlotList>> = {},
) {
  const props = {
    dayKey: DAY,
    slots: SLOTS,
    selectedStart: null,
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<SlotList {...props} />);
  return props;
}

describe('SlotList', () => {
  it('renders the day heading', () => {
    renderList();
    expect(
      screen.getByText(
        `Horarios para el ${formatChileLongDate(new Date(buildLocalISO(DAY, '12:00')))}`,
      ),
    ).toBeInTheDocument();
  });

  it('shows a date-only heading without any time of day', () => {
    renderList();
    const heading = screen.getByText(/^Horarios para el/);
    expect(heading.textContent).not.toMatch(/\d{1,2}:\d{2}|a\. m\.|p\. m\./);
  });

  it('exposes the slots in a group named "Horarios disponibles"', () => {
    renderList();
    const group = screen.getByRole('group', { name: 'Horarios disponibles' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(
      SLOTS.map((s) => formatSlotTimeRange(s.start, s.end)),
    );
  });

  it('marks only the selected slot with aria-pressed', () => {
    renderList({ selectedStart: SLOTS[1].start });
    const [first, second] = within(
      screen.getByRole('group', { name: 'Horarios disponibles' }),
    ).getAllByRole('button');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSelect with the clicked slot', async () => {
    const { onSelect } = renderList();
    await userEvent.click(
      screen.getByRole('button', {
        name: formatSlotTimeRange(SLOTS[0].start, SLOTS[0].end),
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(SLOTS[0]);
  });

  it('shows the empty state without a group when there are no slots', () => {
    renderList({ slots: [] });
    expect(
      screen.getByText('Sin horarios disponibles este día.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Horarios disponibles' }),
    ).not.toBeInTheDocument();
  });

  it('uses touch-sized buttons, sage for the selected one and no emerald', () => {
    const { container } = render(
      <SlotList
        dayKey={DAY}
        slots={SLOTS}
        selectedStart={SLOTS[0].start}
        onSelect={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((b) => expect(b.className).toContain('min-h-11'));
    expect(buttons[0].className).toContain('bg-sage-600');
    expect(container.innerHTML).not.toContain('emerald');
  });

  it('does not mention price or duration', () => {
    const { container } = render(
      <SlotList
        dayKey={DAY}
        slots={SLOTS}
        selectedStart={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(
      /\$|CLP|precio|duraci[oó]n|min\b/i,
    );
  });
});
