import { NavLink } from 'react-router';
import { Wallet } from 'lucide-react';
import { useSubscriptionStatus } from '../../hooks/useSubscription';

// Issue #611: entrada del menú a la pantalla de suscripción. Mientras el
// interruptor del backend está apagado (o el estado no se conoce) no aparece,
// para no mostrar una pantalla que todavía no cobra.
export default function SubscriptionNavLink({ onClick }: { onClick: () => void }) {
  const { data: status } = useSubscriptionStatus();

  if (!status?.enforced) return null;

  return (
    <NavLink
      to="/suscripcion"
      onClick={onClick}
      className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
    >
      <Wallet size={18} />
      Suscripción
    </NavLink>
  );
}
