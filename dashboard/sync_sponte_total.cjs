const fs = require('fs');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Lendo as variáveis de ambiente manualmente (como é um arquivo .cjs isolado)
const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...vParts] = line.split('=');
  if (k && vParts.length) {
    env[k.trim()] = vParts.join('=').trim();
  }
});

const supaUrl = env.VITE_SUPABASE_URL;
const supaKey = env.VITE_SUPABASE_ANON_KEY;

if (!supaUrl || !supaKey) {
  console.error("Faltando VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no arquivo .env");
  process.exit(1);
}

const supabase = createClient(supaUrl, supaKey);

// ==========================================
// PARSER XML BASEADO EM REGEX
// ==========================================
function parseItems(xml) {
  const regex = /<wsParcelaPagar>([\s\S]*?)<\/wsParcelaPagar>/g;
  let match;
  const items = [];
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return m ? m[1].trim() : '';
    };

    items.push({
      contaPagarID: get('ContaPagarID'),
      numeroParcela: get('NumeroParcela'),
      sacado: get('Sacado'),
      situacao: get('SituacaoParcela'),
      vencimento: get('Vencimento'),
      dataPagamento: get('DataPagamento'),
      valorParcela: get('ValorParcela'),
      valorPago: get('ValorPago'),
      categoria: get('Categoria'),
      formaCobranca: get('FormaCobranca'),
      tipoRecebimento: get('TipoRecebimento')
    });
  }
  return items;
}

function parseMoeda(val) {
  if (!val) return 0;
  return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDateDB(s) {
  if (!s) return null;
  if (s.includes('T')) return new Date(s).toISOString().split('T')[0];
  const parts = s.split(' ')[0].split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return null;
}

// ==========================================
// GERAÇÃO DE DATAS (Historico: 01/01/2025 a 30/04/2026)
// ==========================================
function getDiasHistorico() {
  const result = [];
  const start = new Date(2025, 0, 1);
  const end = new Date(2026, 3, 30); // 30/04/2026
  const cur = new Date(start);
  while (cur <= end) {
    const dd = String(cur.getDate()).padStart(2, '0');
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const yyyy = cur.getFullYear();
    result.push(`${dd}/${mm}/${yyyy}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ==========================================
// FUNÇÕES DE DB E INTEGRAÇÃO
// ==========================================
async function upsertContas(unidadeId, items) {
  if (!items || items.length === 0) return;

  const payload = items.map(p => ({
    unidade_id: unidadeId,
    conta_pagar_id: parseInt(p.contaPagarID, 10),
    numero_parcela: p.numeroParcela,
    sacado: p.sacado,
    categoria: p.categoria,
    forma_cobranca: p.formaCobranca,
    tipo_recebimento: p.tipoRecebimento,
    vencimento: parseDateDB(p.vencimento),
    data_pagamento: parseDateDB(p.dataPagamento),
    valor_parcela: parseMoeda(p.valorParcela),
    valor_pago: parseMoeda(p.valorPago),
    situacao_parcela: p.situacao || 'Pendente',
    sincronizado_em: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('etp_contas_pagar')
    .upsert(payload, { onConflict: 'unidade_id,conta_pagar_id,numero_parcela' });

  if (error) {
    console.error('Erro no UPSERT Supabase:', error);
  }
}

// ==========================================
// ROTINA PRINCIPAL
// ==========================================
async function main() {
  console.log("-----------------------------------------");
  console.log("ROTINA DE IMPORTAÇÃO HISTÓRICA DO SPONTE");
  console.log("-----------------------------------------");

  // 1. Buscar todas as unidades ativas
  const { data: unidades, error } = await supabase.from('etp_unidades').select('*').eq('ativo', true);
  if (error || !unidades || unidades.length === 0) {
    console.log("Nenhuma unidade encontrada ou falha ao buscar unidades.");
    return;
  }

  console.log(`Encontrada(s) ${unidades.length} unidade(s) cadastradas:`, unidades.map(u => u.nome).join(', '));

  for (const unidade of unidades) {
    const codSponte = unidade.codigo_sponte;
    const token = unidade.token_sponte;
    const unidadeId = unidade.id;

    console.log(`\n=========================================`);
    console.log(`🚀 INICIANDO UNIDADE: ${unidade.nome} (Código: ${codSponte})`);
    
    // --------------------------------------------------------------------------------
    // PASSO A: Importar PENDENTES (Vencimento de 2024 até 2027)
    // --------------------------------------------------------------------------------
    console.log(`[PASS A] Buscando Contas Pendentes...`);
    try {
      const pRes = await axios.get('https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar', {
        params: {
          nCodigoCliente: codSponte,
          sToken: token,
          sParametrosBusca: `Situacao=A Pagar&DataInicial=01/01/2024&DataFinal=31/12/2027`
        },
        timeout: 40000
      });
      const pendentes = parseItems(pRes.data);
      if (pendentes.length > 0) {
        console.log(`      > Recebidos ${pendentes.length} pendentes. Gravando no DB...`);
        await upsertContas(unidadeId, pendentes);
      } else {
        console.log(`      > Nenhuma pendente encontrada.`);
      }
    } catch (e) {
      console.error(`      > ERRO ao buscar Pendentes:`, e.message);
    }

    // --------------------------------------------------------------------------------
    // PASSO B: Importar PAGAS / QUITADAS dia-a-dia 
    // --------------------------------------------------------------------------------
    const dias = getDiasHistorico();
    console.log(`\n[PASS B] Buscando Contas Pagas (${dias.length} dias: 01/01/2025 até 30/04/2026)...`);
    
    // Batch reduzido para garantir que a Sponte não gere Timeout
    const BATCH = 5; 
    let totalPagasCadastradas = 0;

    for (let i = 0; i < dias.length; i += BATCH) {
      const lote = dias.slice(i, i + BATCH);
      process.stdout.write(`      > Lote de dias ${lote[0]} a ${lote[lote.length - 1]}... `);
      
      try {
        const batchResults = await Promise.all(
          lote.map(dataPesq =>
            axios.get('https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar', {
              params: {
                nCodigoCliente: codSponte, sToken: token, sParametrosBusca: `DataPagamento=${dataPesq}`
              },
              timeout: 25000
            }).then(r => parseItems(r.data).filter(p => p.situacao && p.situacao !== 'Pendente'))
            .catch(() => [])
          )
        );

        const itensDoLote = batchResults.flat();
        if (itensDoLote.length > 0) {
          process.stdout.write(`(${itensDoLote.length} registros). Salvando... `);
          await upsertContas(unidadeId, itensDoLote);
          totalPagasCadastradas += itensDoLote.length;
        } else {
          process.stdout.write(`vazio.`);
        }
        console.log(` OK`);
      } catch (e) {
        console.log(` ERRO - ${e.message}`);
      }
    }
    
    console.log(`\n✅ CONCLUÍDO UNIDADE: ${unidade.nome}. Total de Pagas Inseridas: ${totalPagasCadastradas}`);
  }

  console.log("\n-----------------------------------------");
  console.log("!!! SINCRONIZAÇÃO COMPLETA !!!");
  console.log("Você pode checar o seu painel do Supabase agora.");
}

main();
