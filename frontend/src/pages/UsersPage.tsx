import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Shield, User, X, Crown, Users, Check, Pencil, Eye, EyeOff } from 'lucide-react';
import api from '../api/client';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  mfaEnabled: boolean;
  createdAt: string;
}

const ROLES = [
  { value: 'THERAPIST', label: 'Terapeuta' },
  { value: 'COORDINATOR', label: 'Coordinador/a' },
  { value: 'SUPERVISOR', label: 'Supervisor/a' },
  { value: 'ADMIN', label: 'Administrador' },
];

const roleLabel = (role: string) => ROLES.find(r => r.value === role)?.label ?? role;

const roleBadge = (role: string) => {
  switch (role) {
    case 'ADMIN':       return 'bg-purple-50 text-purple-700';
    case 'SUPERVISOR':  return 'bg-indigo-50 text-indigo-700';
    case 'COORDINATOR': return 'bg-blue-50 text-blue-700';
    default:            return 'bg-sage-50 text-sage-700';
  }
};

const roleIcon = (role: string) => {
  switch (role) {
    case 'ADMIN':       return <Shield size={16} className="text-purple-600" />;
    case 'SUPERVISOR':  return <Crown size={16} className="text-indigo-600" />;
    case 'COORDINATOR': return <Users size={16} className="text-blue-600" />;
    default:            return <User size={16} className="text-sage-600" />;
  }
};

const CAN_EDIT_ROLES = ['ADMIN', 'SUPERVISOR', 'COORDINATOR'];

export default function UsersPage() {
  const queryClient = useQueryClient();
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const canEditRoles = CAN_EDIT_ROLES.includes(currentUser?.role);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'THERAPIST' });
  const [error, setError] = useState('');

  // Edit modal state
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', password: '' });
  const [editError, setEditError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Inline role editing (mantener para compatibilidad móvil)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState('');

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r: any) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setError('');
      setForm({ email: '', name: '', password: '', role: 'THERAPIST' });
    },
    onError: (err: any) => {
      setError(err.response?.data?.message ?? 'Error al crear usuario');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      setEditError('');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      setEditError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Error al actualizar usuario'));
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/users/${id}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingRoleId(null);
    },
    onError: (err: any) => {
      alert(err.response?.data?.message ?? 'Error al actualizar rol');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => {
      alert(err.response?.data?.message ?? 'Error al eliminar usuario');
    },
  });

  const handleDelete = (u: UserItem) => {
    if (!confirm(`¿Eliminar al usuario "${u.name}"? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate(u.id);
  };

  const handleOpenEdit = (u: UserItem) => {
    setEditingUser(u);
    setEditForm({ name: u.name, email: u.email, role: u.role, password: '' });
    setEditError('');
    setShowPassword(false);
  };

  const handleSubmitEdit = () => {
    if (!editingUser) return;
    if (!editForm.name.trim()) { setEditError('El nombre es obligatorio'); return; }
    if (!editForm.email.trim()) { setEditError('El email es obligatorio'); return; }
    if (editForm.password && editForm.password.length < 8) {
      setEditError('La contraseña debe tener al menos 8 caracteres'); return;
    }

    const data: any = {
      name: editForm.name,
      email: editForm.email,
      role: editForm.role,
    };
    if (editForm.password) data.password = editForm.password;

    updateMutation.mutate({ id: editingUser.id, data });
  };

  const handleRoleClick = (u: UserItem) => {
    if (!canEditRoles) return;
    setEditingRoleId(u.id);
    setEditingRole(u.role);
  };

  const handleRoleSave = (id: string) => {
    updateRoleMutation.mutate({ id, role: editingRole });
  };

  const RoleCell = ({ u }: { u: UserItem }) => {
    if (editingRoleId === u.id) {
      return (
        <div className="flex items-center gap-1">
          <select
            value={editingRole}
            onChange={e => setEditingRole(e.target.value)}
            className="text-xs border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            autoFocus
          >
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button onClick={() => handleRoleSave(u.id)} disabled={updateRoleMutation.isPending}
            className="p-1 hover:bg-green-50 rounded text-green-600 transition-colors" title="Guardar">
            <Check size={14} />
          </button>
          <button onClick={() => setEditingRoleId(null)}
            className="p-1 hover:bg-slate-100 rounded text-slate-400 transition-colors" title="Cancelar">
            <X size={14} />
          </button>
        </div>
      );
    }

    return (
      <span
        onClick={() => handleRoleClick(u)}
        title={canEditRoles ? 'Clic para cambiar rol' : ''}
        className={`text-xs px-2 py-1 rounded-full ${roleBadge(u.role)} ${
          canEditRoles ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''
        }`}
      >
        {roleLabel(u.role)}
        {canEditRoles && <span className="ml-1 opacity-50">✎</span>}
      </span>
    );
  };

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h2 className="font-display text-2xl md:text-3xl text-slate-900">Usuarios</h2>
          <p className="text-slate-500 text-sm mt-1">{users.length} usuarios registrados</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          <UserPlus size={16} />
          <span className="hidden sm:inline">Nuevo usuario</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {/* Formulario nuevo usuario */}
      {showForm && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-slate-900">Nuevo Usuario</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
              <input className="input-field" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
              <input type="email" className="input-field" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña *</label>
              <input type="password" className="input-field" value={form.password}
                placeholder="Mínimo 8 caracteres"
                onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Rol</label>
              <select className="input-field" value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button onClick={() => createMutation.mutate(form)} className="btn-primary">
              {createMutation.isPending ? 'Guardando...' : 'Crear usuario'}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista desktop */}
      <div className="hidden md:block card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Usuario</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">
                Rol {canEditRoles && <span className="text-indigo-400">(clic para editar)</span>}
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">MFA</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Creado</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-400">
                  No hay usuarios registrados.
                </td>
              </tr>
            ) : (
              users.map((u: UserItem) => (
                <tr key={u.id} className="hover:bg-cream-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <RoleCell u={u} />
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      u.mfaEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {u.mfaEnabled ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {new Date(u.createdAt).toLocaleDateString('es-CL')}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleOpenEdit(u)}
                        className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400 transition-colors" title="Editar">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(u)}
                        className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 transition-colors" title="Eliminar">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Cards móvil */}
      <div className="md:hidden space-y-3">
        {users.length === 0 ? (
          <div className="card text-center py-8 text-slate-400 text-sm">
            No hay usuarios registrados.
          </div>
        ) : (
          users.map((u: UserItem) => (
            <div key={u.id} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2 rounded-lg">
                    {roleIcon(u.role)}
                  </div>
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleOpenEdit(u)}
                    className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => handleDelete(u)}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-red-400">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <RoleCell u={u} />
                <span className={`text-xs px-2 py-1 rounded-full ${
                  u.mfaEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  MFA {u.mfaEnabled ? 'activo' : 'inactivo'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal edición */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="font-display text-xl text-slate-900">Editar Usuario</h3>
                <p className="text-slate-400 text-sm">{editingUser.email}</p>
              </div>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo *</label>
                <input className="input-field" value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                <input type="email" className="input-field" value={editForm.email}
                  onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Rol</label>
                <select className="input-field" value={editForm.role}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Nueva contraseña <span className="text-slate-400 font-normal">(dejar vacío para no cambiar)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field pr-10"
                    placeholder="Mínimo 8 caracteres"
                    value={editForm.password}
                    onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            {editError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
                <p className="text-red-600 text-sm">{editError}</p>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={handleSubmitEdit} className="btn-primary flex-1"
                disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button onClick={() => setEditingUser(null)} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}