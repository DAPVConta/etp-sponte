const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const codigoCliente = '35695';
  const token = 'fxW1Et2vS8Vf';

  const queries = [
    { name: 'todas', params: `Situacao=Todas&DataInicial=01/02/2026&DataFinal=28/02/2026` },
    { name: 'dpag', params: `DataInicialPagamento=01/02/2026&DataFinalPagamento=28/02/2026` },
    { name: 'dpag_sit', params: `Situacao=Todas&DataInicialPagamento=01/02/2026&DataFinalPagamento=28/02/2026` },
    { name: 'sit_pagas', params: `Situacao=Pagas&DataInicial=01/02/2026&DataFinal=28/02/2026` }
  ];

  for (const q of queries) {
    try {
      console.log('Fetching', q.name);
      const res = await axios.get(url, {
        params: { nCodigoCliente: codigoCliente, sToken: token, sParametrosBusca: q.params }
      });
      fs.writeFileSync(`c:/tmp/sponte2_${q.name}.xml`, res.data);
      console.log(`Saved c:/tmp/sponte2_${q.name}.xml, length: ${res.data.length}`);
    } catch (e) {
      console.error('Error on', q.name, e.message);
    }
  }
}

test();
