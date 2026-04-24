import { supabase } from '../lib/supabase';
import type { CategoriaDespesa, CategoriaReceita, ParcelaPagar, ParcelaReceber } from '../types';

// Converte formatações pt-BR como "DD/MM/YYYY hh:mm:ss" ou "DD/MM/YYYY" para ISO YYYY-MM-DD
const parseDateForDB = (s: string): string | null => {
  if (!s) return null;
  if (s.includes('T')) return new Date(s).toISOString().split('T')[0]; // Já é ISO?

  const parts = s.split(' ')[0].split('/'); // Pega só a data
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return null;
};

// Converte string numérica (potencialmente vazia) para number | null
const toIntOrNull = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === '') return null;
  const n = typeof s === 'number' ? s : parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
};

export const SyncAPI = {
  // Sincroniza Categorias de Despesas (Upsert)
  async syncCategorias(unidadeId: string, categorias: CategoriaDespesa[]): Promise<void> {
    if (!categorias || categorias.length === 0) return;

    const payload = categorias.map(c => ({
      unidade_id: unidadeId,
      categoria_id: c.categoriaID,
      nome: c.nome,
      sincronizado_em: new Date().toISOString()
    }));

    // Upsert usando a constraint de unicidade: uq_cat_unidade (unidade_id, categoria_id)
    const { error } = await supabase
      .from('etp_categorias_despesas')
      .upsert(payload, { onConflict: 'unidade_id,categoria_id' });

    if (error) {
      console.error('Erro ao sincronizar categorias no Supabase:', error);
      throw error;
    }
  },

  // Sincroniza Categorias de Receitas (Upsert)
  async syncCategoriasReceitas(unidadeId: string, categorias: CategoriaReceita[]): Promise<void> {
    if (!categorias || categorias.length === 0) return;

    const payload = categorias.map(c => ({
      unidade_id: unidadeId,
      categoria_id: c.categoriaID,
      nome: c.nome,
      sincronizado_em: new Date().toISOString()
    }));

    // Upsert usando a constraint: uq_cat_rec_unidade (unidade_id, categoria_id)
    const { error } = await supabase
      .from('etp_categorias_receitas')
      .upsert(payload, { onConflict: 'unidade_id,categoria_id' });

    if (error) {
      console.error('Erro ao sincronizar categorias de receitas no Supabase:', error);
      throw error;
    }
  },

  // Sincroniza Contas a Pagar (Upsert)
  async syncContasPagar(unidadeId: string, parcelas: ParcelaPagar[]): Promise<void> {
    if (!parcelas || parcelas.length === 0) return;

    // Quebra em lotes para não estourar os limites do payload do Supabase (ex: 500 por lote)
    const BATCH_SIZE = 500;

    for (let i = 0; i < parcelas.length; i += BATCH_SIZE) {
      const batch = parcelas.slice(i, i + BATCH_SIZE);

      // Mapeia ParcelaPagar para etp_contas_pagar
      const payload = batch.map(p => ({
        unidade_id: unidadeId,
        conta_pagar_id: parseInt(p.ContaPagarID, 10),
        numero_parcela: p.NumeroParcela,
        sacado: p.Sacado,
        categoria: p.Categoria,
        forma_cobranca: p.FormaCobranca,
        tipo_recebimento: p.TipoRecebimento,
        vencimento: parseDateForDB(p.Vencimento),
        data_pagamento: parseDateForDB(p.DataPagamento),
        valor_parcela: p.ValorParcela || 0,
        valor_pago: p.ValorPago || 0,
        situacao_parcela: p.SituacaoParcela || 'Pendente',
        sincronizado_em: new Date().toISOString()
      }));

      // Upsert usando a constraint: uq_conta_pagar_unidade (unidade_id, conta_pagar_id, numero_parcela)
      const { error } = await supabase
        .from('etp_contas_pagar')
        .upsert(payload, { onConflict: 'unidade_id,conta_pagar_id,numero_parcela' });

      if (error) {
        console.error('Erro ao sincronizar lote de contas a pagar no Supabase:', error);
        throw error;
      }
    }
  },

  // Sincroniza Contas a Receber (Upsert)
  async syncContasReceber(unidadeId: string, parcelas: ParcelaReceber[]): Promise<void> {
    if (!parcelas || parcelas.length === 0) return;

    const BATCH_SIZE = 500;

    for (let i = 0; i < parcelas.length; i += BATCH_SIZE) {
      const batch = parcelas.slice(i, i + BATCH_SIZE);

      const payload = batch.map(p => ({
        unidade_id: unidadeId,
        conta_receber_id: parseInt(p.ContaReceberID, 10),
        numero_parcela: p.NumeroParcela,
        sacado: p.Sacado,
        aluno_id: toIntOrNull(p.AlunoID),
        categoria: p.Categoria,
        forma_cobranca: p.FormaCobranca,
        tipo_recebimento: p.TipoRecebimento,
        bolsa_associada: p.BolsaAssociada || null,
        numero_boleto: toIntOrNull(p.NumeroBoleto),
        fatura_id: toIntOrNull(p.FaturaID),
        conta_id: toIntOrNull(p.ContaID),
        vencimento: parseDateForDB(p.Vencimento),
        data_pagamento: parseDateForDB(p.DataPagamento),
        valor_parcela: p.ValorParcela || 0,
        valor_pago: p.ValorPago || 0,
        situacao_parcela: p.SituacaoParcela || 'A Receber',
        situacao_cnab: p.SituacaoCNAB || null,
        sincronizado_em: new Date().toISOString()
      }));

      // Upsert usando a constraint: uq_conta_receber_unidade (unidade_id, conta_receber_id, numero_parcela)
      const { error } = await supabase
        .from('etp_contas_receber')
        .upsert(payload, { onConflict: 'unidade_id,conta_receber_id,numero_parcela' });

      if (error) {
        console.error('Erro ao sincronizar lote de contas a receber no Supabase:', error);
        throw error;
      }
    }
  },

  // Loga uma operação de sincronização
  async logSync(unidadeId: string, tipo: string, status: string, total: number, mensagemErro?: string): Promise<void> {
    const { error } = await supabase
      .from('etp_sync_log')
      .insert({
        unidade_id: unidadeId,
        tipo_sync: tipo,
        total_registros: total,
        status: status,
        mensagem_erro: mensagemErro || null,
        concluido_em: new Date().toISOString()
      });

    if (error) {
      console.error('Erro ao criar log de sincronização:', error);
    }
  }
};
