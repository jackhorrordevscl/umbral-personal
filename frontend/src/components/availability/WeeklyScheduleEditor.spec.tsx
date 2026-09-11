import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WeeklyScheduleEditor from './WeeklyScheduleEditor'
import api from '../../api/client'

// sdd/patient-self-scheduling PR 4 (tasks.md 4.1/4.4, therapist-availability
// Req: Weekly Recurring Schedule): editor de la grilla semanal +
// sessionDurationMinutes, wireado a PUT /availability/schedule.

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WeeklyScheduleEditor />
    </QueryClientProvider>,
  )
}

describe('WeeklyScheduleEditor — therapist-availability Req: Weekly Recurring Schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/availability/schedule') {
        return Promise.resolve({ data: { sessionDurationMinutes: 50, entries: [] } })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.put.mockResolvedValue({ data: undefined })
  })

  it('guarda un horario válido y lo envía a PUT /availability/schedule', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Agregar horario para Lunes' }),
    )

    await user.click(screen.getByRole('button', { name: 'Guardar horario' }))

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith('/availability/schedule', {
        sessionDurationMinutes: 50,
        entries: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }],
      }),
    )
    expect(
      await screen.findByText('Horario guardado correctamente.'),
    ).toBeInTheDocument()
  })

  it('rechaza un horario con startTime >= endTime y no llama a PUT', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Agregar horario para Lunes' }),
    )

    const endInput = screen.getByLabelText('Lunes hora de término 0')
    await user.clear(endInput)
    await user.type(endInput, '08:00')

    await user.click(screen.getByRole('button', { name: 'Guardar horario' }))

    expect(
      await screen.findByText('La hora de término debe ser posterior a la de inicio'),
    ).toBeInTheDocument()
    expect(mockedApi.put).not.toHaveBeenCalled()
  })
})
