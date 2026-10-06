import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProfileCard from './ProfileCard';
import type { PublicTherapistProfile } from '../../api/publicScheduling';

const AVATAR_URL = '/api/public/therapists/t1/avatar';

const baseProfile: PublicTherapistProfile = {
  name: 'Ana Pérez',
  bio: null,
  specialty: null,
  website: null,
  hasAvatar: false,
};

function renderCard(overrides: Partial<PublicTherapistProfile> = {}) {
  return render(<ProfileCard profile={{ ...baseProfile, ...overrides }} avatarUrl={AVATAR_URL} />);
}

describe('ProfileCard', () => {
  it('muestra el nombre como heading de nivel 1', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 1, name: 'Ana Pérez' })).toBeInTheDocument();
  });

  it('muestra el avatar cuando hasAvatar es true', () => {
    renderCard({ hasAvatar: true });
    const img = screen.getByRole('img', { name: 'Ana Pérez' });
    expect(img).toHaveAttribute('src', AVATAR_URL);
  });

  it('muestra las iniciales cuando no hay avatar', () => {
    renderCard();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('AP')).toBeInTheDocument();
  });

  it('no muestra especialidad ni bio cuando no existen', () => {
    const { container } = renderCard();
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('span.rounded-full')).toBeNull();
  });

  it('muestra especialidad y bio cuando existen', () => {
    renderCard({ specialty: 'Psicología clínica', bio: 'Trabajo con adultos.' });
    expect(screen.getByText('Psicología clínica')).toBeInTheDocument();
    expect(screen.getByText('Trabajo con adultos.')).toBeInTheDocument();
  });

  it('acota la bio en pantallas bajo lg y la muestra completa desde lg', () => {
    const longBio = 'Línea larga de presentación. '.repeat(40).trim();
    renderCard({ bio: longBio });
    const bio = screen.getByText(longBio);
    expect(bio.className).toMatch(/\bline-clamp-\d\b/);
    expect(bio).toHaveClass('lg:line-clamp-none');
    expect(bio).toHaveClass('whitespace-pre-line');
  });

  it('no ofrece un boton para ver mas', () => {
    renderCard({ bio: 'Bio larga '.repeat(60) });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/ver más/i)).not.toBeInTheDocument();
  });

  it('muestra el sitio web como link cuando es https', () => {
    renderCard({ website: 'https://ejemplo.cl/ana' });
    const link = screen.getByRole('link', { name: /ejemplo\.cl\/ana/ });
    expect(link).toHaveAttribute('href', 'https://ejemplo.cl/ana');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no renderiza ningun link sin sitio web', () => {
    renderCard({ bio: 'Hola' });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('no renderiza ningun link para un website javascript:', () => {
    const { container } = renderCard({ website: 'javascript:alert(1)' });
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('no muestra precio ni duracion', () => {
    renderCard({ specialty: 'Psicología', bio: 'Hola' });
    expect(screen.queryByText(/\$|CLP|min\b|minutos/i)).not.toBeInTheDocument();
  });
});
