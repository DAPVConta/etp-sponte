import { useState } from 'react';
import {
  Building2, Plus, Pencil, Trash2, X, Check, AlertCircle, Palette, Hash, Key, FileText, Loader2
} from 'lucide-react';
import type { Unidade } from '../types';
import { UnidadesAPI } from '../api/unidades';

// Preset color palette for units
const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e', '#84cc16',
  '#14b8a6', '#a855f7', '#d946ef', '#f97316', '#0ea5e9',
];

function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const calc = (d: string, len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(d.charAt(len - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return (
    calc(digits, 12) === parseInt(digits.charAt(12)) &&
    calc(digits, 13) === parseInt(digits.charAt(13))
  );
}

interface FormData {
  cnpj: string;
  nome: string;
  cor: string;
  codigoSponte: string;
  tokenSponte: string;
}

const emptyForm: FormData = { cnpj: '', nome: '', cor: '#6366f1', codigoSponte: '', tokenSponte: '' };

interface Props {
  unidades: Unidade[];
  onUpdateUnidades: () => Promise<void>;
  accentColor: string;
}

export default function UnidadesPage({ unidades, onUpdateUnidades, accentColor }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [serverError, setServerError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};
    if (!form.cnpj || form.cnpj.replace(/\D/g, '').length < 14) {
      newErrors.cnpj = 'CNPJ inválido';
    } else if (!validateCNPJ(form.cnpj)) {
      newErrors.cnpj = 'CNPJ inválido (dígitos verificadores não conferem)';
    }
    if (!form.nome.trim()) newErrors.nome = 'Nome é obrigatório';
    if (!form.codigoSponte.trim()) newErrors.codigoSponte = 'Código Sponte é obrigatório';
    if (!form.tokenSponte.trim()) newErrors.tokenSponte = 'Token Sponte é obrigatório';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    
    setLoading(true);
    setServerError('');
    
    try {
      if (editingId) {
        await UnidadesAPI.atualizar(editingId, form);
      } else {
        await UnidadesAPI.criar(form);
      }
      await onUpdateUnidades();
      closeForm();
    } catch (err: any) {
      console.error('Erro ao salvar unidade:', err);
      setServerError(err.message || 'Ocorreu um erro ao salvar a unidade no banco de dados.');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (u: Unidade) => {
    setForm({ cnpj: u.cnpj, nome: u.nome, cor: u.cor, codigoSponte: u.codigoSponte, tokenSponte: u.tokenSponte });
    setEditingId(u.id);
    setErrors({});
    setServerError('');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    setServerError('');
    try {
      await UnidadesAPI.excluir(id);
      await onUpdateUnidades();
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error('Erro ao excluir unidade:', err);
      setServerError(err.message || 'Ocorreu um erro ao excluir a unidade.');
    } finally {
      setLoading(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setErrors({});
    setServerError('');
  };

  const handleCNPJChange = (v: string) => {
    setForm(f => ({ ...f, cnpj: formatCNPJ(v) }));
    if (errors.cnpj) setErrors(e => ({ ...e, cnpj: undefined }));
  };

  const toggleToken = (id: string) =>
    setShowToken(s => ({ ...s, [id]: !s[id] }));

  return (
    <div className="page-content">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ color: accentColor }}>
            <Building2 size={28} style={{ display: 'inline', marginRight: 10, verticalAlign: 'middle' }} />
            Cadastro de Unidades
          </h1>
          <p className="page-description">Gerencie as unidades educacionais e suas integrações com o Sponte</p>
        </div>
        <button
          className="btn-primary"
          style={{ background: accentColor, boxShadow: `0 4px 14px ${accentColor}55` }}
          onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); setErrors({}); }}
        >
          <Plus size={18} /> Nova Unidade
        </button>
      </div>

      {serverError && !showForm && !deleteConfirm && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>{serverError}</span>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !loading) closeForm(); }}>
          <div className="modal-card">
            <div className="modal-header">
              <h2>{editingId ? 'Editar Unidade' : 'Nova Unidade'}</h2>
              <button className="modal-close" onClick={closeForm} disabled={loading}><X size={20} /></button>
            </div>

            <div className="modal-body">
              {serverError && (
                <div className="error-banner" style={{ marginBottom: 0 }}>
                  <AlertCircle size={20} />
                  <span>{serverError}</span>
                </div>
              )}

              {/* Color Picker */}
              <div className="form-group">
                <label className="form-label">
                  <Palette size={14} /> Cor da Unidade
                </label>
                <div className="color-picker-row">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      className={`color-dot ${form.cor === c ? 'selected' : ''}`}
                      style={{ background: c, boxShadow: form.cor === c ? `0 0 0 3px ${c}55` : 'none' }}
                      onClick={() => !loading && setForm(f => ({ ...f, cor: c }))}
                      title={c}
                      disabled={loading}
                    >
                      {form.cor === c && <Check size={12} color="white" />}
                    </button>
                  ))}
                  <div className="color-custom-wrap">
                    <input
                      type="color"
                      value={form.cor}
                      onChange={e => setForm(f => ({ ...f, cor: e.target.value }))}
                      className="color-input-native"
                      title="Cor personalizada"
                      disabled={loading}
                    />
                    <span className="color-custom-label">Personalizar</span>
                  </div>
                </div>
                <div
                  className="color-preview-bar"
                  style={{ background: `linear-gradient(90deg, ${form.cor}, ${form.cor}88)` }}
                />
              </div>

              {/* CNPJ */}
              <div className="form-group">
                <label className="form-label"><FileText size={14} /> CNPJ</label>
                <input
                  type="text"
                  className={`form-input ${errors.cnpj ? 'input-error' : ''}`}
                  placeholder="00.000.000/0000-00"
                  value={form.cnpj}
                  onChange={e => handleCNPJChange(e.target.value)}
                  maxLength={18}
                  disabled={loading}
                />
                {errors.cnpj && <span className="field-error"><AlertCircle size={12} />{errors.cnpj}</span>}
              </div>

              {/* Nome */}
              <div className="form-group">
                <label className="form-label"><Building2 size={14} /> Nome da Unidade</label>
                <input
                  type="text"
                  className={`form-input ${errors.nome ? 'input-error' : ''}`}
                  placeholder="Ex: ETP Recife — Unidade Centro"
                  value={form.nome}
                  onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); if (errors.nome) setErrors(v => ({ ...v, nome: undefined })); }}
                  disabled={loading}
                />
                {errors.nome && <span className="field-error"><AlertCircle size={12} />{errors.nome}</span>}
              </div>

              {/* Row: Código + Token */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label"><Hash size={14} /> Código Sponte</label>
                  <input
                    type="text"
                    className={`form-input ${errors.codigoSponte ? 'input-error' : ''}`}
                    placeholder="Ex: 35695"
                    value={form.codigoSponte}
                    onChange={e => { setForm(f => ({ ...f, codigoSponte: e.target.value })); if (errors.codigoSponte) setErrors(v => ({ ...v, codigoSponte: undefined })); }}
                    disabled={loading}
                  />
                  {errors.codigoSponte && <span className="field-error"><AlertCircle size={12} />{errors.codigoSponte}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label"><Key size={14} /> Token Sponte</label>
                  <input
                    type="text"
                    className={`form-input ${errors.tokenSponte ? 'input-error' : ''}`}
                    placeholder="Ex: fxW1Et2vS8Vf"
                    value={form.tokenSponte}
                    onChange={e => { setForm(f => ({ ...f, tokenSponte: e.target.value })); if (errors.tokenSponte) setErrors(v => ({ ...v, tokenSponte: undefined })); }}
                    disabled={loading}
                  />
                  {errors.tokenSponte && <span className="field-error"><AlertCircle size={12} />{errors.tokenSponte}</span>}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeForm} disabled={loading}>Cancelar</button>
              <button
                className="btn-primary"
                style={{ background: form.cor, ...(!loading ? { boxShadow: `0 4px 14px ${form.cor}55` } : { opacity: 0.7 }) }}
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                {editingId ? 'Salvar Alterações' : 'Cadastrar Unidade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-card modal-sm">
            <div className="modal-header">
              <h2>Confirmar Exclusão</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)} disabled={loading}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {serverError && (
                <div className="error-banner" style={{ marginBottom: 0 }}>
                  <AlertCircle size={20} />
                  <span>{serverError}</span>
                </div>
              )}
              <div className="delete-warning">
                <AlertCircle size={32} color="#ef4444" />
                <p>Tem certeza que deseja excluir a unidade <strong>{unidades.find(u => u.id === deleteConfirm)?.nome}</strong>?</p>
                <p className="delete-warning-sub">Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)} disabled={loading}>Cancelar</button>
              <button className="btn-danger" onClick={() => handleDelete(deleteConfirm)} disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />} 
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Units Grid */}
      {unidades.length === 0 ? (
        <div className="empty-state">
          <Building2 size={64} color="#334155" />
          <h3>Nenhuma unidade cadastrada</h3>
          <p>Comece cadastrando a primeira unidade educacional.</p>
          <button
            className="btn-primary"
            style={{ background: accentColor }}
            onClick={() => setShowForm(true)}
          >
            <Plus size={18} /> Cadastrar Primeira Unidade
          </button>
        </div>
      ) : (
        <div className="units-grid">
          {unidades.map(u => (
            <div
              key={u.id}
              className="unit-card"
              style={{ borderTop: `4px solid ${u.cor}` }}
            >
              {/* Card top stripe */}
              <div className="unit-card-header">
                <div className="unit-color-badge" style={{ background: `${u.cor}22`, color: u.cor }}>
                  <Building2 size={16} />
                </div>
                <div className="unit-actions">
                  <button className="icon-btn" onClick={() => handleEdit(u)} title="Editar">
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn danger" onClick={() => setDeleteConfirm(u.id)} title="Excluir">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <h3 className="unit-name">{u.nome}</h3>
              <p className="unit-cnpj">{u.cnpj}</p>

              <div className="unit-fields">
                <div className="unit-field">
                  <span className="unit-field-label">
                    <Hash size={12} /> Código Sponte
                  </span>
                  <span className="unit-field-value" style={{ color: u.cor }}>{u.codigoSponte}</span>
                </div>
                <div className="unit-field">
                  <span className="unit-field-label">
                    <Key size={12} /> Token
                  </span>
                  <span className="unit-field-value token-value">
                    {showToken[u.id]
                      ? u.tokenSponte
                      : '••••••••••••'}
                    <button
                      className="token-toggle"
                      onClick={() => toggleToken(u.id)}
                      title={showToken[u.id] ? 'Ocultar token' : 'Mostrar token'}
                    >
                      {showToken[u.id] ? '🙈' : '👁️'}
                    </button>
                  </span>
                </div>
              </div>

              <div className="unit-footer">
                <span className="unit-date">
                  Cadastrado em {new Date(u.criadoEm).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
