import { useState, useRef, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Download, Trash2, FileText, Image,
  BookOpen, File, Search, X, Plus, AlertCircle, Pencil, ExternalLink,
} from 'lucide-react';
import api from '../api/client';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { getApiErrorMessage } from '../utils/api-error';
import { downloadBlob } from '../utils/download';

const CATEGORIES = [
  { value: '', label: 'Todos' },
  { value: 'LIBRO', label: 'Libros' },
  { value: 'PLANTILLA', label: 'Plantillas' },
  { value: 'IMAGEN', label: 'Imágenes' },
  { value: 'FORMULARIO', label: 'Formularios' },
  { value: 'PROTOCOLO', label: 'Protocolos' },
  { value: 'GENERAL', label: 'General' },
];

const ALLOWED_EXTENSIONS = [
  'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX',
  'JPG', 'PNG', 'GIF', 'WEBP', 'TXT', 'ZIP',
];

const categoryIcon = (cat: string) => {
  switch (cat) {
    case 'LIBRO': return <BookOpen className="w-5 h-5 text-indigo-500" />;
    case 'IMAGEN': return <Image className="w-5 h-5 text-pink-500" />;
    case 'PLANTILLA': return <FileText className="w-5 h-5 text-green-500" />;
    default: return <File className="w-5 h-5 text-slate-400" />;
  }
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Determina si el archivo se puede previsualizar en el browser
const isPreviewable = (mimetype: string) =>
  ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimetype);

interface SharedFile {
  id: string;
  name: string;
  originalName: string;
  category: string;
  description?: string;
  size: number;
  mimetype: string;
  createdAt: string;
  uploadedBy: { name: string };
}

export default function SharedFilesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [fileToDelete, setFileToDelete] = useState<SharedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'GENERAL',
    file: null as File | null,
  });

  // Edit modal state
  const [editingFile, setEditingFile] = useState<SharedFile | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', category: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const { data: files = [], isLoading, isError: filesError } = useQuery<SharedFile[]>({
    queryKey: ['shared-files', category],
    queryFn: () =>
      api.get(`/shared-files${category ? `?category=${category}` : ''}`).then(r => r.data),
  });

  // Un fetch fallido no debe verse igual que "sin archivos" -- se avisa con
  // el mismo banner que ya usan las acciones de descarga/borrado (issue #23).
  const displayError = error || (filesError ? 'No se pudo cargar el repositorio de archivos. Reintenta más tarde.' : '');

  const handleUpload = async () => {
    setUploadError('');
    if (!form.file) { setUploadError('Selecciona un archivo'); return; }
    if (!form.name.trim()) { setUploadError('Ingresa un nombre'); return; }

    const fd = new FormData();
    fd.append('file', form.file);
    fd.append('name', form.name.trim());
    fd.append('description', form.description);
    fd.append('category', form.category);

    try {
      setUploading(true);
      await api.post('/shared-files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowUpload(false);
      setForm({ name: '', description: '', category: 'GENERAL', file: null });
      queryClient.invalidateQueries({ queryKey: ['shared-files'] });
    } catch (e) {
      setUploadError(getApiErrorMessage(e, 'Error al subir el archivo. Intenta nuevamente.'));
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (file: SharedFile) => {
    try {
      const res = await api.get(`/shared-files/${file.id}/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: file.mimetype });
      const url = window.URL.createObjectURL(blob);
      // No se revoca acá: la pestaña nueva sigue necesitando el blob URL
      // después de este punto (a diferencia de handleDownload, que dispara
      // la descarga y termina en el mismo tick).
      window.open(url, '_blank');
    } catch {
      setError('Error al abrir el archivo');
    }
  };

  const handleDownload = async (file: SharedFile) => {
    try {
      const res = await api.get(`/shared-files/${file.id}/download`, {
        responseType: 'blob',
      });
      downloadBlob(new Blob([res.data]), file.originalName);
    } catch {
      setError('Error al descargar el archivo');
    }
  };

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    const id = fileToDelete.id;
    setFileToDelete(null);
    try {
      await api.delete(`/shared-files/${id}`);
      queryClient.invalidateQueries({ queryKey: ['shared-files'] });
    } catch (e) {
      setError(getApiErrorMessage(e, 'Error al eliminar'));
    }
  };

  const handleOpenEdit = (file: SharedFile) => {
    setEditingFile(file);
    setEditForm({ name: file.name, description: file.description ?? '', category: file.category });
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;
    if (!editForm.name.trim()) { setEditError('El nombre es obligatorio'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      await api.patch(`/shared-files/${editingFile.id}`, {
        name: editForm.name.trim(),
        description: editForm.description,
        category: editForm.category,
      });
      queryClient.invalidateQueries({ queryKey: ['shared-files'] });
      setEditingFile(null);
    } catch (e) {
      setEditError(getApiErrorMessage(e, 'Error al guardar'));
    } finally {
      setEditSaving(false);
    }
  };

  const filtered = files.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.uploadedBy?.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Repositorio de Archivos</h1>
          <p className="text-slate-500 text-sm mt-1">Tus plantillas, formularios y protocolos</p>
        </div>
        <button
          onClick={() => { setShowUpload(true); setUploadError(''); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Subir archivo
        </button>
      </div>

      {displayError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex justify-between items-center">
          <p className="text-red-600 text-sm">{displayError}</p>
          {error && (
            <button onClick={() => setError('')}><X className="w-4 h-4 text-red-400" /></button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar archivos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                category === c.value
                  ? 'bg-sage-600 text-white border-sage-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-slate-400">Cargando archivos...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <File className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay archivos en esta categoría</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(file => (
            <div key={file.id} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0">{categoryIcon(file.category)}</div>
              <div
                role="button"
                tabIndex={0}
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => handlePreview(file)}
                onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePreview(file);
                  }
                }}
                title="Clic para abrir en nueva pestaña"
              >
                <p className="font-medium text-slate-800 truncate hover:text-sage-600 transition-colors flex items-center gap-1">
                  {file.name}
                  {isPreviewable(file.mimetype) && (
                    <ExternalLink className="w-3 h-3 text-slate-300 inline shrink-0" />
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {file.originalName} · {formatSize(file.size)}
                </p>
                {file.description && (
                  <p className="text-xs text-slate-500 mt-1 truncate">{file.description}</p>
                )}
              </div>
              <span className="hidden sm:inline text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full shrink-0">
                {CATEGORIES.find(c => c.value === file.category)?.label ?? file.category}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleOpenEdit(file)}
                  className="p-2 rounded-lg hover:bg-blue-50 text-blue-400 transition-colors" title="Editar"
                  aria-label={`Editar ${file.name}`}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDownload(file)}
                  className="p-2 rounded-lg hover:bg-sage-50 text-sage-600 transition-colors" title="Descargar"
                  aria-label={`Descargar ${file.name}`}>
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={() => setFileToDelete(file)}
                  className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Eliminar"
                  aria-label={`Eliminar ${file.name}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal subir archivo */}
      {showUpload && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Escape') setShowUpload(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-file-title"
            className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 id="upload-file-title" className="text-lg font-semibold text-slate-800">
                Subir archivo
              </h2>
              <button onClick={() => setShowUpload(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-sage-300 transition-colors mb-4"
              onClick={() => fileInputRef.current?.click()}
            >
              {form.file ? (
                <p className="text-sm text-sage-600 font-medium">{form.file.name}</p>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Haz clic para seleccionar un archivo</p>
                  <p className="text-xs text-slate-400 mt-1">Máx. 50 MB</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setForm(prev => ({
                    ...prev,
                    file: f,
                    // Pre-rellenar nombre con el nombre del archivo sin extensión
                    name: prev.name || f.name.replace(/\.[^/.]+$/, ''),
                  }));
                }}
              />
            </div>

            {/* Formatos admitidos */}
            <div className="bg-slate-50 rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-slate-500 font-medium mb-1">Formatos admitidos:</p>
              <div className="flex flex-wrap gap-1">
                {ALLOWED_EXTENSIONS.map(ext => (
                  <span key={ext} className="text-xs bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                    .{ext.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="upload-name" className="block text-xs font-medium text-slate-600 mb-1">
                  Nombre del archivo <span className="text-red-500">*</span>
                </label>
                <input
                  id="upload-name"
                  type="text"
                  placeholder="Ej: Protocolo de atención 2026"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="input-field"
                />
              </div>
              <select
                value={form.category}
                onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
                className="input-field"
                aria-label="Categoría del archivo"
              >
                {CATEGORIES.filter(c => c.value).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <textarea
                placeholder="Descripción (opcional)"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="input-field resize-none"
                aria-label="Descripción del archivo"
              />
            </div>

            {uploadError && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-600 text-xs">{uploadError}</p>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowUpload(false)}
                className="btn-secondary flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {uploading ? 'Subiendo...' : 'Subir archivo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar archivo */}
      {editingFile && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Escape') setEditingFile(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-file-title"
            className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 id="edit-file-title" className="text-lg font-semibold text-slate-800">
                Editar archivo
              </h2>
              <button onClick={() => setEditingFile(null)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="edit-file-name" className="block text-xs font-medium text-slate-600 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  id="edit-file-name"
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label htmlFor="edit-file-category" className="block text-xs font-medium text-slate-600 mb-1">Categoría</label>
                <select
                  id="edit-file-category"
                  value={editForm.category}
                  onChange={e => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                  className="input-field"
                >
                  {CATEGORIES.filter(c => c.value).map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-file-description" className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                <textarea
                  id="edit-file-description"
                  value={editForm.description}
                  onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="input-field resize-none"
                />
              </div>
            </div>

            {editError && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-600 text-xs">{editError}</p>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditingFile(null)}
                className="btn-secondary flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {fileToDelete && (
        <ConfirmDialog
          title="Eliminar archivo"
          message={`¿Eliminar "${fileToDelete.name}" del repositorio?`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setFileToDelete(null)}
        />
      )}
    </div>
  );
}