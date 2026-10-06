import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingCalendar from './BookingCalendar';
import {
  buildLocalISO,
  chileMonthGridRange,
  formatChileLongDate,
} from '../../utils/datetime';
import type { PublicSlot } from '../../api/publicScheduling';

const TODAY = '2026-10-06';
const GRID = chileMonthGridRange(2026, 10);

function slot(day: string, time: string): PublicSlot {
  return { start: buildLocalISO(day, time), end: buildLocalISO(day, '23:00') };
}

// 6 de octubre (hoy), 8 de octubre y 3 de noviembre (celda fuera del mes).
const SLOTS_BY_DAY: Record<string, PublicSlot[]> = {
  '2026-10-06': [slot('2026-10-06', '15:00')],
  '2026-10-08': [slot('2026-10-08', '10:00'), slot('2026-10-08', '11:00')],
  '2026-11-03': [slot('2026-11-03', '09:00')],
};

function dayName(day: string): string {
  return `Ver horarios del ${formatChileLongDate(new Date(buildLocalISO(day, '12:00')))}`;
}

function renderCalendar(
  overrides: Partial<React.ComponentProps<typeof BookingCalendar>> = {},
) {
  const props = {
    viewMonth: { year: 2026, month: 10 },
    days: GRID.days,
    slotsByDay: SLOTS_BY_DAY,
    selectedDay: null,
    todayKey: TODAY,
    busy: false,
    onPrevMonth: vi.fn(),
    onNextMonth: vi.fn(),
    onSelectDay: vi.fn(),
    ...overrides,
  };
  const utils = render(<BookingCalendar {...props} />);
  return { ...utils, props };
}

function cells() {
  return within(
    screen.getByRole('group', { name: 'Días con horarios disponibles' }),
  ).getAllByRole('button');
}

describe('BookingCalendar', () => {
  it('renderiza 42 celdas dentro del grupo de días', () => {
    renderCalendar();
    expect(cells()).toHaveLength(42);
  });

  it('muestra el mes y la fila de días de la semana oculta a lectores de pantalla', () => {
    const { container } = renderCalendar();
    expect(screen.getByText('Octubre 2026')).toBeInTheDocument();
    const header = container.querySelector('[aria-hidden="true"].grid-cols-7');
    expect(header).not.toBeNull();
    expect(Array.from(header!.children).map((c) => c.textContent)).toEqual([
      'L',
      'M',
      'X',
      'J',
      'V',
      'S',
      'D',
    ]);
  });

  it('conserva el nombre accesible "Ver horarios del <fecha>" en los días con horarios', () => {
    renderCalendar();
    expect(
      screen.getByRole('button', { name: dayName('2026-10-08') }),
    ).toBeEnabled();
  });

  it('deshabilita los días sin horarios, incluidos los pasados', () => {
    renderCalendar();
    expect(
      screen.getByRole('button', { name: dayName('2026-10-07') }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: dayName('2026-10-02') }),
    ).toBeDisabled();
  });

  it('mantiene clickeable un día con horarios fuera del mes visible', async () => {
    const { props } = renderCalendar();
    const cell = screen.getByRole('button', { name: dayName('2026-11-03') });
    expect(cell).toBeEnabled();
    await userEvent.click(cell);
    expect(props.onSelectDay).toHaveBeenCalledWith('2026-11-03');
  });

  it('no atenúa un día con horarios fuera del mes para no perder contraste', () => {
    renderCalendar();
    const cell = screen.getByRole('button', { name: dayName('2026-11-03') });
    expect(cell.className).not.toContain('opacity-60');
  });

  it('atenúa un día sin horarios fuera del mes', () => {
    renderCalendar();
    const cell = screen.getByRole('button', { name: dayName('2026-11-04') });
    expect(cell).toBeDisabled();
    expect(cell.className).toContain('opacity-60');
  });

  it('llama onSelectDay con la clave del día', async () => {
    const { props } = renderCalendar();
    await userEvent.click(
      screen.getByRole('button', { name: dayName('2026-10-08') }),
    );
    expect(props.onSelectDay).toHaveBeenCalledWith('2026-10-08');
  });

  it('marca aria-pressed solo en el día seleccionado, con clases sage', () => {
    renderCalendar({ selectedDay: '2026-10-08' });
    const selected = screen.getByRole('button', {
      name: dayName('2026-10-08'),
    });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected.className).toContain('bg-sage-600');
    expect(
      screen.getByRole('button', { name: dayName('2026-10-06') }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('marca aria-current="date" solo en hoy y le agrega una señal que no es de color', () => {
    renderCalendar();
    const current = cells().filter(
      (c) => c.getAttribute('aria-current') === 'date',
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(dayName('2026-10-06'));
    // Punto inferior (after:) como indicador adicional al color.
    expect(current[0].className).toContain('after:rounded-full');
  });

  it('usa celdas de 44px de alto', () => {
    renderCalendar();
    for (const cell of cells()) {
      expect(cell.className).toContain('h-11');
    }
  });

  it('dispara los callbacks de navegación de mes', async () => {
    const { props } = renderCalendar();
    await userEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Mes siguiente' }),
    );
    expect(props.onPrevMonth).toHaveBeenCalledTimes(1);
    expect(props.onNextMonth).toHaveBeenCalledTimes(1);
  });

  it('refleja busy en aria-busy del grupo de días', () => {
    const { rerender, props } = renderCalendar({ busy: true });
    const group = screen.getByRole('group', {
      name: 'Días con horarios disponibles',
    });
    expect(group).toHaveAttribute('aria-busy', 'true');
    rerender(<BookingCalendar {...props} busy={false} />);
    expect(group).toHaveAttribute('aria-busy', 'false');
  });

  it('muestra la cantidad de horarios en un elemento aria-hidden sin alterar el nombre accesible', () => {
    renderCalendar({
      slotsByDay: {
        ...SLOTS_BY_DAY,
        '2026-10-09': [
          slot('2026-10-09', '10:00'),
          slot('2026-10-09', '11:00'),
          slot('2026-10-09', '12:00'),
        ],
      },
    });
    const cell = screen.getByRole('button', { name: dayName('2026-10-09') });
    const count = within(cell).getByText('3');
    expect(count).toHaveAttribute('aria-hidden', 'true');
    expect(cell).toHaveAccessibleName(dayName('2026-10-09'));
  });

  it('no muestra cantidad en los días sin horarios', () => {
    renderCalendar();
    const cell = screen.getByRole('button', { name: dayName('2026-10-07') });
    expect(cell.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('conserva las clases sage del día seleccionado con la cantidad visible', () => {
    renderCalendar({ selectedDay: '2026-10-08' });
    const selected = screen.getByRole('button', {
      name: dayName('2026-10-08'),
    });
    expect(selected.className).toContain('bg-sage-600');
    expect(within(selected).getByText('2')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('no usa la paleta emerald', () => {
    const { container } = renderCalendar({ selectedDay: '2026-10-08' });
    expect(container.innerHTML).not.toContain('emerald');
  });
});
