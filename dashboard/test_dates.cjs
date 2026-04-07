const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const queries = [
    { name: 'DataInicial', params: 'DataInicial=01/02/2026&DataFinal=28/02/2026' },
    { name: 'dataInicial', params: 'dataInicial=01/02/2026&dataFinal=28/02/2026' },
    { name: 'data_inicial', params: 'data_inicial=01/02/2026&data_final=28/02/2026' },
  ];

  for (const q of queries) {
    try {
      const res = await axios.get(url, {
        params: { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: q.params }
      });
      console.log(`${q.name}: length = ${res.data.length}, match wsParcelaPagar = ${(res.data.match(/<wsParcelaPagar>/g) || []).length}`);
    } catch (e) {
      console.error(q.name, e.message);
    }
  }
}

test();
