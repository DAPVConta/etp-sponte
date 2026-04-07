const axios = require('axios');
const fs = require('fs');

// Gera todas as datas de fevereiro de 2026
function getDiasFebraeiro() {
  const dias = [];
  for (let d = 1; d <= 28; d++) {
    const dd = String(d).padStart(2, '0');
    dias.push(`${dd}/02/2026`);
  }
  return dias;
}

async function queryDate(date) {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const res = await axios.get(url, {
    params: {
      nCodigoCliente: '35695',
      sToken: 'fxW1Et2vS8Vf',
      sParametrosBusca: `DataPagamento=${date}`
    },
    timeout: 20000
  });
  return res.data;
}

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
    const sit = get('SituacaoParcela');
    if (!sit || sit === 'Pendente') continue; // Ignorar pendentes
    items.push({
      contaPagarID: get('ContaPagarID'),
      numeroParcela: get('NumeroParcela'),
      sacado: get('Sacado'),
      situacao: sit,
      vencimento: get('Vencimento'),
      dataPagamento: get('DataPagamento'),
      valorParcela: get('ValorParcela'),
      valorPago: get('ValorPago'),
      categoria: get('Categoria'),
      formaCobranca: get('FormaCobranca'),
    });
  }
  return items;
}

function parseMoeda(val) {
  if (!val) return 0;
  return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0;
}

async function main() {
  const datas = getDiasFebraeiro();
  const todosItems = [];
  const resumoPorData = {};

  console.log('Buscando pagamentos de fevereiro/2026 dia a dia...\n');

  for (const data of datas) {
    try {
      const xml = await queryDate(data);
      const items = parseItems(xml);
      if (items.length > 0) {
        todosItems.push(...items);
        resumoPorData[data] = items.length;
        const total = items.reduce((s, i) => s + parseMoeda(i.valorPago), 0);
        console.log(`  ${data}: ${items.length} item(s) | Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      }
    } catch (e) {
      console.error(`  ${data}: ERRO - ${e.message}`);
    }
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Total de parcelas pagas/quitadas em fev/2026: ${todosItems.length}`);
  
  const totalGeral = todosItems.reduce((s, i) => s + parseMoeda(i.valorPago), 0);
  console.log(`Total pago: R$ ${totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

  // Resumo por categoria
  const porCategoria = {};
  for (const item of todosItems) {
    const cat = item.categoria || 'Sem Categoria';
    if (!porCategoria[cat]) porCategoria[cat] = { count: 0, total: 0 };
    porCategoria[cat].count++;
    porCategoria[cat].total += parseMoeda(item.valorPago);
  }

  console.log(`\n=== POR CATEGORIA ===`);
  for (const [cat, info] of Object.entries(porCategoria).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${cat}: ${info.count} parcela(s) | R$ ${info.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }

  // Tabela detalhada
  console.log(`\n=== DETALHES (${todosItems.length} parcelas) ===`);
  console.log('Data Pag | Vencimento | Sacado | Categoria | Valor Pago | Situacao');
  console.log('-'.repeat(100));
  for (const item of todosItems.sort((a, b) => a.dataPagamento.localeCompare(b.dataPagamento))) {
    console.log(`${item.dataPagamento} | ${item.vencimento} | ${item.sacado.substring(0, 25).padEnd(25)} | ${item.categoria.substring(0,20).padEnd(20)} | R$ ${parseMoeda(item.valorPago).toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(12)} | ${item.situacao}`);
  }

  // Salvar JSON completo
  fs.writeFileSync('c:/tmp/contas_pagas_fev2026.json', JSON.stringify(todosItems, null, 2));
  console.log(`\nArquivo completo salvo em: c:/tmp/contas_pagas_fev2026.json`);
}

main();
