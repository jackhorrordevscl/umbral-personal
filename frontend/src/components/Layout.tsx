import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import {
  LayoutDashboard, Users, ClipboardList,
  LogOut, ShieldCheck, Menu, X, FolderOpen
} from 'lucide-react';
import { useAuth } from '../context/useAuth';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/patients', icon: Users, label: 'Pacientes' },
    { to: '/consultations', icon: ClipboardList, label: 'Consultas' },
    { to: '/archivos', icon: FolderOpen, label: 'Repositorio' },
    { to: '/settings', icon: ShieldCheck, label: 'Seguridad' },
  ];

  return (
    <div className="flex h-screen bg-cream-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30
        w-64 bg-slate-900 flex flex-col
        transform transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        <div className="px-6 py-8 border-b border-slate-800 flex items-center justify-between">
          <div>
            <img src="/logo.svg" alt="Umbral — Registro Clínico Electrónico" className="h-14 w-auto" />
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-6 space-y-1">
          {navLinks.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-800">
          <div className="px-4 py-2 mb-2">
            <p className="text-white text-sm font-medium truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="sidebar-link w-full text-left text-red-400 hover:text-red-300 hover:bg-red-950"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-600 hover:text-slate-900"
          >
            <Menu size={22} />
          </button>
          <img src="/favicon.svg" alt="Umbral" className="h-9 w-9 rounded" />
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}