const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const base = { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf' };

  // Combinações focadas com DataPagamento (que parece funcionar!)
  const queries = [
    'DataPagamento=01/02/2026',
    'DataPagamento=28/02/2026',
    'DataPagamento=05/02/2026',
    'DataPagamento=10/02/2026',
    'DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    'DataInicialPagamento=01/02/2026&DataFinalPagamento=28/02/2026',
    'DataInicialPagamento=01/02/2026',
    'DataFinalPagamento=28/02/2026',
    'Situacao=Quitada&DataInicialPagamento=01/02/2026&DataFinalPagamento=28/02/2026',
    'Situacao=Quitada&DataInicioPagamento=01/02/2026&DataFimPagamento=28/02/2026',
    'Situacao=Quitada&DataInicial=01/02/2026&DataFinal=28/02/2026',
    'Situacao=Quitada',
  ];

  const log = [];

  for (const q of queries) {
    try {
      const res = await axios.get(url, {
        params: { ...base, sParametrosBusca: q },
        timeout: 15000
      });
      
      const xml = res.data;
      const count = (xml.match(/<wsParcelaPagar>/g) || []).length;
      
      const sitRegex = /<SituacaoParcela>(.*?)<\/SituacaoParcela>/g;
      let m;
      const sits = new Set();
      while ((m = sitRegex.exec(xml)) !== null) sits.add(m[1].trim());
      
      const datapagRegex = /<DataPagamento>([^<]+)<\/DataPagamento>/g;
      let dp;
      const datasPag = [];
      while ((dp = datapagRegex.exec(xml)) !== null) {
        const d = dp[1].trim();
        if (d) datasPag.push(d);
      }
      
      const febItems = datasPag.filter(d => d.includes('/02/2026'));
      
      const entry = `PARAMS: ${q}\n  Total: ${count} | Situacoes: [${[...sits].join(', ')}] | DataPag amostras: ${datasPag.slice(0,5).join(', ')} | Feb2026: ${febItems.length}\n`;
      log.push(entry);
      
      if (count > 0 && febItems.length > 0) {
        fs.writeFileSync(`c:/tmp/pagar_feb_${count}.xml`, xml);
        log.push(`  *** SALVO! ***\n`);
      }
    } catch (e) {
      log.push(`PARAMS: ${q} => ERRO: ${e.message}\n`);
    }
  }

  const out = log.join('\n');
  fs.writeFileSync('c:/tmp/test_results.txt', out);
  console.log(out);
}

test();
