import { useState, useRef, useCallback, useEffect } from 'react';
import { Settings, Upload, ImageIcon, Loader2, Check, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isLightColor } from '@/lib/color-utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEmpresaConfig } from '@/contexts/EmpresaConfigContext';
import { useAuth } from '@/contexts/AuthContext';

// ── Utilidades de cor ────────────────────────────────────────────

function isValidHex(hex: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function clamp(v: number) { return Math.max(0, Math.min(255, v)); }

// ── Componente ColorPicker ────────────────────────────────────────

interface ColorPickerProps {
  label: string;
  description?: string;
  value: string;
  onChange: (hex: string) => void;
}

function ColorPicker({ label, description, value, onChange }: ColorPickerProps) {
  const rgb = isValidHex(value) ? hexToRgb(value) : { r: 99, g: 102, b: 241 };

  const [hexInput, setHexInput] = useState(value);
  const [rInput, setRInput] = useState(String(rgb.r));
  const [gInput, setGInput] = useState(String(rgb.g));
  const [bInput, setBInput] = useState(String(rgb.b));

  useEffect(() => {
    if (isValidHex(value)) {
      const { r, g, b } = hexToRgb(value);
      setHexInput(value);
      setRInput(String(r));
      setGInput(String(g));
      setBInput(String(b));
    }
  }, [value]);

  const commitHex = (raw: string) => {
    const hex = raw.startsWith('#') ? raw : '#' + raw;
    if (isValidHex(hex)) onChange(hex);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>

      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <label className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Picker</label>
          <label className="relative cursor-pointer" title="Clique para escolher a cor">
            <div
              className="w-12 h-12 rounded-lg border-2 border-border shadow-sm transition-transform hover:scale-105"
              style={{ background: isValidHex(value) ? value : '#6366f1' }}
            />
            <input
              type="color"
              value={isValidHex(value) ? value : '#6366f1'}
              onChange={e => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </label>
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Hexadecimal</label>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded border border-border flex-shrink-0" style={{ background: isValidHex(value) ? value : '#6366f1' }} />
              <Input
                value={hexInput}
                maxLength={7}
                placeholder="#6366f1"
                className="font-mono h-9 text-sm"
                onChange={e => {
                  const v = e.target.value;
                  setHexInput(v);
                  const hex = v.startsWith('#') ? v : '#' + v;
                  if (isValidHex(hex)) {
                    const { r, g, b } = hexToRgb(hex);
                    setRInput(String(r));
                    setGInput(String(g));
                    setBInput(String(b));
                    onChange(hex);
                  }
                }}
                onBlur={() => commitHex(hexInput)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">RGB</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'R', value: rInput, set: setRInput, color: '#ef4444' },
                { label: 'G', value: gInput, set: setGInput, color: '#22c55e' },
                { label: 'B', value: bInput, set: setBInput, color: '#3b82f6' },
              ].map(({ label: ch, value: cv, set, color }) => (
                <div key={ch} className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] font-semibold" style={{ color }}>{ch}</span>
                  <Input
                    type="number"
                    min={0}
                    max={255}
                    value={cv}
                    className="h-9 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onChange={e => {
                      set(e.target.value);
                      const r2 = ch === 'R' ? e.target.value : rInput;
                      const g2 = ch === 'G' ? e.target.value : gInput;
                      const b2 = ch === 'B' ? e.target.value : bInput;
                      const rn = clamp(parseInt(r2) || 0);
                      const gn = clamp(parseInt(g2) || 0);
                      const bn = clamp(parseInt(b2) || 0);
                      const hex = rgbToHex(rn, gn, bn);
                      setHexInput(hex);
                      onChange(hex);
                    }}
                    onBlur={() => {
                      const rn = clamp(parseInt(rInput) || 0);
                      const gn = clamp(parseInt(gInput) || 0);
                      const bn = clamp(parseInt(bInput) || 0);
                      setRInput(String(rn));
                      setGInput(String(gn));
                      setBInput(String(bn));
                      const hex = rgbToHex(rn, gn, bn);
                      if (isValidHex(hex)) onChange(hex);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preview ao vivo ──────────────────────────────────────────────

function LayoutPreview({
  corFundoMenu,
  corFundo,
  corFundoContainers,
  accentColor,
  logoSrc,
}: {
  corFundoMenu: string;
  corFundo: string;
  corFundoContainers: string;
  accentColor: string;
  logoSrc: string;
}) {
  const menuEscuro = !isLightColor(corFundoMenu);
  const menuFg = menuEscuro ? '#e2e8f0' : '#1e293b';
  const menuMuted = menuEscuro ? '#94a3b8' : '#64748b';
  const accentFg = isLightColor(accentColor) ? '#1a1a2e' : '#ffffff';
  const fundoEscuro = !isLightColor(corFundo);
  const textColor = fundoEscuro ? '#e2e8f0' : '#1e293b';
  const mutedText = fundoEscuro ? '#94a3b8' : '#64748b';
  const containerFgEscuro = !isLightColor(corFundoContainers);
  const containerText = containerFgEscuro ? '#e2e8f0' : '#1e293b';
  const containerMuted = containerFgEscuro ? '#94a3b8' : '#64748b';
  const containerBorder = containerFgEscuro ? '#334155' : '#e2e8f0';

  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-md" style={{ width: 320, height: 360 }}>
      <div className="flex h-full">
        {/* Mini sidebar */}
        <div className="w-[72px] flex flex-col py-3 px-2 flex-shrink-0" style={{ background: corFundoMenu }}>
          {/* Logo */}
          <div className="flex items-center justify-center mb-3">
            {logoSrc ? (
              <img src={logoSrc} alt="" className="w-8 h-8 object-contain rounded" />
            ) : (
              <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center">
                <span className="text-[8px] font-bold" style={{ color: menuFg }}>ETP</span>
              </div>
            )}
          </div>

          {/* Menu items */}
          <div className="space-y-1">
            {/* Active */}
            <div
              className="rounded-md py-1 px-1.5 flex items-center gap-1.5"
              style={{ background: accentColor }}
            >
              <div className="w-2.5 h-2.5 rounded" style={{ background: accentFg, opacity: 0.7 }} />
              <span className="text-[7px] font-semibold truncate" style={{ color: accentFg }}>Dashboard</span>
            </div>
            {/* Inactive items */}
            {['Unidades', 'Categorias', 'Config.'].map(item => (
              <div key={item} className="rounded-md py-1 px-1.5 flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded" style={{ background: menuMuted, opacity: 0.4 }} />
                <span className="text-[7px] truncate" style={{ color: menuMuted }}>{item}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-auto pt-2">
            <div
              className="rounded py-1 px-1.5 flex items-center gap-1"
              style={{ background: `${accentColor}25` }}
            >
              <div className="w-2 h-2 rounded-full" style={{ background: accentColor }} />
              <span className="text-[6px] font-semibold truncate" style={{ color: accentColor }}>Unidade</span>
            </div>
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden" style={{ background: corFundo }}>
          {/* Header */}
          <div className="mb-3">
            <span className="text-[9px] font-bold" style={{ color: textColor }}>Dashboard Financeiro</span>
            <p className="text-[7px] mt-0.5" style={{ color: mutedText }}>Visão geral do sistema</p>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {['Receita', 'Despesas', 'Saldo'].map(kpi => (
              <div
                key={kpi}
                className="rounded-md p-1.5 border"
                style={{ background: corFundoContainers, borderColor: containerBorder }}
              >
                <span className="text-[6px] block" style={{ color: containerMuted }}>{kpi}</span>
                <span className="text-[9px] font-bold block mt-0.5" style={{ color: containerText }}>
                  R$ {Math.floor(Math.random() * 90 + 10)}k
                </span>
              </div>
            ))}
          </div>

          {/* Chart placeholder */}
          <div
            className="flex-1 rounded-md border p-2 flex flex-col"
            style={{ background: corFundoContainers, borderColor: containerBorder }}
          >
            <span className="text-[7px] font-semibold mb-1" style={{ color: containerText }}>Receita Mensal</span>
            <div className="flex-1 flex items-end gap-[3px] pb-1">
              {[40, 55, 35, 70, 60, 80, 65, 90, 75, 85, 70, 95].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm transition-all"
                  style={{
                    height: `${h}%`,
                    background: i === 11 ? accentColor : `${accentColor}30`,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1">
              {['Jan', '', '', '', '', '', '', '', '', '', '', 'Dez'].map((m, i) => (
                <span key={i} className="text-[5px]" style={{ color: containerMuted }}>{m}</span>
              ))}
            </div>
          </div>

          {/* Table placeholder */}
          <div
            className="mt-2 rounded-md border p-1.5"
            style={{ background: corFundoContainers, borderColor: containerBorder }}
          >
            <div className="flex gap-2 mb-1 pb-1 border-b" style={{ borderColor: containerBorder }}>
              <span className="text-[6px] font-semibold flex-1" style={{ color: containerMuted }}>Descrição</span>
              <span className="text-[6px] font-semibold w-12 text-right" style={{ color: containerMuted }}>Valor</span>
            </div>
            {[{ d: 'Aluguel', v: '5.200' }, { d: 'Folha', v: '12.800' }].map(({ d, v }) => (
              <div key={d} className="flex gap-2 py-0.5">
                <span className="text-[6px] flex-1" style={{ color: containerText }}>{d}</span>
                <span className="text-[6px] w-12 text-right font-medium" style={{ color: containerText }}>R$ {v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 py-1.5 border-t border-border bg-muted/30">
        {[
          { cor: corFundoMenu, label: 'Menu' },
          { cor: corFundo, label: 'Fundo' },
          { cor: corFundoContainers, label: 'Containers' },
        ].map(({ cor, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full border border-border" style={{ background: cor }} />
            <span className="text-[6px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────

interface ConfiguracoesPageProps {
  accentColor: string;
  onLayoutSaved?: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export default function ConfiguracoesPage({ accentColor, onLayoutSaved }: ConfiguracoesPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { config, update } = useEmpresaConfig();
  const { user } = useAuth();

  const [corFundoMenu,       setCorFundoMenu]       = useState('#0d1220');
  const [corFundo,           setCorFundo]           = useState('#f0f2f5');
  const [corFundoContainers, setCorFundoContainers] = useState('#ffffff');
  const [logoUrl,            setLogoUrl]            = useState('');
  const [logoPreview,        setLogoPreview]        = useState<string>('');
  const [uploadStatus,       setUploadStatus]       = useState<UploadStatus>('idle');
  const [uploadError,        setUploadError]        = useState('');
  const [saved,              setSaved]              = useState(false);

  // Sync local state from config context
  useEffect(() => {
    if (config) {
      setCorFundoMenu(config.corFundoMenu);
      setCorFundo(config.corFundo);
      setCorFundoContainers(config.corFundoContainers);
      setLogoUrl(config.logoUrl);
    }
  }, [config]);

  const handleLogoChange = useCallback(async (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setLogoPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploadStatus('uploading');
    setUploadError('');

    const empresaId = user?.empresaId;
    if (!empresaId) {
      setUploadError('Empresa nao identificada.');
      setUploadStatus('error');
      return;
    }

    try {
      const BUCKET = 'Logotipo';
      const ext = file.name.split('.').pop();
      const path = `${empresaId}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadErr) {
        if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
          throw new Error(
            `Bucket "${BUCKET}" nao existe. Crie no Supabase Dashboard → Storage → New bucket → nome: "${BUCKET}", Public: ✓`
          );
        }
        throw new Error(uploadErr.message);
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;

      setLogoUrl(url);
      await update({ logoUrl: url });
      setUploadStatus('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      setUploadStatus('error');
    }
  }, [user?.empresaId, update]);

  const handleSalvar = async () => {
    await update({
      corFundoMenu,
      corFundo,
      corFundoContainers,
    });
    onLayoutSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const logoSrc = logoPreview || logoUrl;

  return (
    <div className="p-8">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-8">
        <Settings size={24} style={{ color: accentColor }} />
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
      </div>

      {/* ── Seção Layout ── */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Layout</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define o padrão visual aplicado em todas as telas do sistema.
          </p>
        </div>

        <div className="flex gap-6 items-start">
          {/* Formulário */}
          <div className="flex-1 max-w-xl rounded-xl border border-border bg-card p-6 space-y-8">

            {/* Logo */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Logotipo</p>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden flex-shrink-0">
                  {logoSrc ? (
                    <img src={logoSrc} alt="Logotipo" className="w-full h-full object-contain p-2" />
                  ) : (
                    <ImageIcon size={28} className="text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleLogoChange(file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={uploadStatus === 'uploading'}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadStatus === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploadStatus === 'uploading' ? 'Enviando…' : 'Enviar imagem'}
                  </Button>
                  {uploadStatus === 'success' && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                      <Check size={12} /> Upload concluído
                    </p>
                  )}
                  {uploadStatus === 'error' && (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle size={12} /> {uploadError}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, SVG, WebP.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-border" />

            <ColorPicker
              label="Cor de fundo do menu"
              description="Aplica cor ao fundo do menu lateral."
              value={corFundoMenu}
              onChange={setCorFundoMenu}
            />

            <div className="border-t border-border" />

            <ColorPicker
              label="Cor de fundo"
              description="Aplica cor de fundo do sistema (exceto menu)."
              value={corFundo}
              onChange={setCorFundo}
            />

            <div className="border-t border-border" />

            <ColorPicker
              label="Cor de fundo dos containers"
              description="Aplica cor de fundo em gráficos, listas, tabelas e cards."
              value={corFundoContainers}
              onChange={setCorFundoContainers}
            />

            {/* Salvar */}
            <div className="flex items-center justify-end pt-2">
              <Button
                onClick={handleSalvar}
                size="sm"
                className={cn('gap-2 transition-all', saved && 'bg-emerald-600 hover:bg-emerald-600')}
                style={!saved ? { background: accentColor } : {}}
              >
                {saved ? <Check size={14} /> : null}
                {saved ? 'Salvo!' : 'Salvar configurações'}
              </Button>
            </div>
          </div>

          {/* Preview ao vivo */}
          <div className="flex-shrink-0 sticky top-8">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-widest">Preview</p>
            <LayoutPreview
              corFundoMenu={corFundoMenu}
              corFundo={corFundo}
              corFundoContainers={corFundoContainers}
              accentColor={accentColor}
              logoSrc={logoSrc}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
