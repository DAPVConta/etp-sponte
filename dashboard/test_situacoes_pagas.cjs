const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const base = { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf' };

  const queries = [
    // Tentar com DataPagamento diretamente
    'DataPagamento=01/02/2026',
    'DataPagamento=28/02/2026',
    'DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    'DataInicialPagamento=01/02/2026&DataFinalPagamento=28/02/2026',
    // Situacao variações
    'Situacao=Baixada&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Baixado&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Quitada&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Quitado&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Pago&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Paga&DataInicial=01/02/2026&DataFinal=28/02/2026',
    // Com data de pagamento e situacao
    'Situacao=Pago&DataPagamento=01/02/2026',
    'Situacao=Pago&DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    'Situacao=Baixado&DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    'Situacao=Quitado&DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    // Sem filtro de data só situacao diferente
    'Situacao=Baixado',
    'Situacao=Quitado',
    'Situacao=Quitada',
    'Situacao=Baixada',
  ];

  console.log('=== Testando GetParcelasPagar - Situacoes Pagas ===\n');

  for (const q of queries) {
    try {
      const res = await axios.get(url, {
        params: { ...base, sParametrosBusca: q },
        timeout: 15000
      });
      
      const count = (res.data.match(/<wsParcelaPagar>/g) || []).length;
      
      // Check situations
      const sitRegex = /<SituacaoParcela>(.*?)<\/SituacaoParcela>/g;
      let m;
      const sits = new Set();
      while ((m = sitRegex.exec(res.data)) !== null) sits.add(m[1]);
      
      // Check if any DataPagamento is filled
      const dataPagRegex = /<DataPagamento>([^<]+)<\/DataPagamento>/g;
      let dp;
      const dataspag = new Set();
      while ((dp = dataPagRegex.exec(res.data)) !== null) {
        if (dp[1].trim()) dataspag.add(dp[1].trim());
      }
      
      // Count items with DataPagamento in Feb 2026
      const febCount = [...dataspag].filter(d => d.includes('/02/2026')).length;
      
      console.log(`PARAMS: ${q}`);
      console.log(`  Total: ${count} | Situacoes: [${[...sits].join(', ')}] | DataPagamento amostras: ${[...dataspag].slice(0, 3).join(', ')} | Feb 2026: ${febCount}`);
      
      // If we found something with DataPagamento in Feb, save it
      if (febCount > 0 || (count > 0 && [...sits].some(s => s !== 'Pendente'))) {
        fs.writeFileSync(`c:/tmp/found_${q.substring(0, 40).replace(/[^a-z0-9]/gi, '_')}.xml`, res.data);
        console.log(`  *** ENCONTROU DADOS RELEVANTES! Salvo em arquivo ***`);
      }
      console.log('');
    } catch (e) {
      console.log(`PARAMS: ${q} => ERRO: ${e.message}\n`);
    }
  }
}

test();
