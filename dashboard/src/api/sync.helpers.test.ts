// Testes de caracterizacao dos helpers de normalizacao usados pela
// sincronizacao (Sponte API) e pelas importacoes de PDF (Caixa/Relatorio).
// Estes helpers definem COMO os dados financeiros sao persistidos — qualquer
// mudanca de comportamento aqui altera dados em producao.
import { describe, it, expect } from 'vitest';
import { parseDateForDB, toIntOrNull, normalizeCategoria } from './sync';

describe('parseDateForDB', () => {
  it('converte "DD/MM/YYYY" para ISO', () => {
    expect(parseDateForDB('15/06/2026')).toBe('2026-06-15');
  });

  it('converte "DD/MM/YYYY hh:mm:ss" descartando a hora', () => {
    expect(parseDateForDB('01/06/2026 10:30:45')).toBe('2026-06-01');
  });

  it('faz pad de dia/mes com 1 digito', () => {
    expect(parseDateForDB('5/6/2026')).toBe('2026-06-05');
  });

  it('repassa datas que ja contem "T" (ISO) pelo Date/toISOString', () => {
    expect(parseDateForDB('2026-06-15T00:00:00Z')).toBe('2026-06-15');
  });

  it('string vazia vira null', () => {
    expect(parseDateForDB('')).toBeNull();
  });

  it('formato irreconhecivel vira null', () => {
    expect(parseDateForDB('junho de 2026')).toBeNull();
  });
});

describe('toIntOrNull', () => {
  it('converte string numerica', () => {
    expect(toIntOrNull('777')).toBe(777);
  });

  it('mantem number', () => {
    expect(toIntOrNull(42)).toBe(42);
  });

  it('vazio/null/undefined viram null', () => {
    expect(toIntOrNull('')).toBeNull();
    expect(toIntOrNull(null)).toBeNull();
    expect(toIntOrNull(undefined)).toBeNull();
  });

  it('nao-numerico vira null', () => {
    expect(toIntOrNull('abc')).toBeNull();
  });
});

describe('normalizeCategoria', () => {
  it('remove pontos finais redundantes do cadastro Sponte', () => {
    expect(normalizeCategoria('Rescisao Contratual..')).toBe('Rescisao Contratual');
  });

  it('remove espacos nas bordas', () => {
    expect(normalizeCategoria('  Aluguel  ')).toBe('Aluguel');
  });

  it('nao altera nomes limpos', () => {
    expect(normalizeCategoria('TAXA BOLETO')).toBe('TAXA BOLETO');
  });

  it('null/undefined viram string vazia', () => {
    expect(normalizeCategoria(null)).toBe('');
    expect(normalizeCategoria(undefined)).toBe('');
  });

  // Comportamento atual (intencional? ver lancamento 24249 da Quali):
  // categoria composta so de pontos colapsa para vazio.
  it('categoria feita so de pontos ("...") colapsa para vazio', () => {
    expect(normalizeCategoria('...')).toBe('');
  });
});
