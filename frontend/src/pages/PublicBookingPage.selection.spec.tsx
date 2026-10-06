import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import PublicBookingPage from './PublicBookingPage';
import api from '../api/client';
import { chileMonthGridRange, toChileDayKey } from '../utils/datetime';

// Complementa PublicBookingPage.spec.tsx (congelado): cubre el scroll guiado al
// elegir día u horario y la selección de día cuando un refetch lo deja vacío.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const dayLabel = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('es-CL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

// Slot en el último día del grid del mes actual: siempre dentro de la grilla.
function futureSlot() {
  const [year, month] = toChileDayKey(new Date().toISOString())
    .split('-')
    .map(Number);
  const { days } = chileMonthGridRange(year, month);
  const dayKey = days[days.length - 1];
  const base = new Date(`${dayKey}T13:00:00Z`);
  const start = base.toISOString();
  const end = new Date(base.getTime() + 50 * 60000).toISOString();
  return { start, end, dayKey: toChileDayKey(start) };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/book/therapist-1']}>
        <Routes>
          <Route path="/book/:therapistId" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function mockAvailability(slots: unknown[]) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/public/therapists/therapist-1/availability') {
      return Promise.resolve({ data: slots });
    }
    return Promise.reject(new Error(`GET inesperado: ${url}`));
  });
}

describe('PublicBookingPage: scroll guiado', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    // jsdom no implementa scrollIntoView: se restaura el estado original.
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('no desplaza la vista al montar', async () => {
    mockAvailability([futureSlot()]);
    renderPage();
    await screen.findByRole('button', {
      name: `Ver horarios del ${dayLabel(futureSlot().dayKey)}`,
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('revela horarios al elegir día y formulario al elegir horario, sin mover el foco', async () => {
    const slot = futureSlot();
    mockAvailability([slot]);
    const user = userEvent.setup();
    renderPage();

    const dayButton = await screen.findByRole('button', {
      name: `Ver horarios del ${dayLabel(slot.dayKey)}`,
    });
    await user.click(dayButton);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ block: 'nearest' }),
    );
    expect(dayButton).toHaveFocus();

    const group = await screen.findByRole('group', {
      name: 'Horarios disponibles',
    });
    const slotButton = within(group).getAllByRole('button')[0];
    await user.click(slotButton);

    expect(
      await screen.findByRole('button', { name: 'Confirmar reserva' }),
    ).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(slotButton).toHaveFocus();
  });
});
