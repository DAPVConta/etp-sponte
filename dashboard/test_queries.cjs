const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const codigoCliente = '35695';
  const token = 'fxW1Et2vS8Vf';

  const queries = [
    { name: 'todas', params: `DataInicial=01/02/2026&DataFinal=28/02/2026` },
    { name: 'apagar', params: `Situacao=A Pagar&DataInicial=01/02/2026&DataFinal=28/02/2026` },
    { name: 'paga', params: `Situacao=Paga&DataInicial=01/02/2026&DataFinal=28/02/2026` },
    { name: 'pago', params: `Situacao=Pago&DataInicial=01/02/2026&DataFinal=28/02/2026` } // sometimes APIs use Pago instead of Paga
  ];

  for (const q of queries) {
    try {
      console.log('Fetching', q.name);
      const res = await axios.get(url, {
        params: { nCodigoCliente: codigoCliente, sToken: token, sParametrosBusca: q.params }
      });
      fs.writeFileSync(`c:/tmp/sponte_${q.name}.xml`, res.data);
      console.log(`Saved c:/tmp/sponte_${q.name}.xml, length: ${res.data.length}`);
      
      const regex = /<wsParcelaPagar>/g;
      const count = (res.data.match(regex) || []).length;
      console.log(`  Count for ${q.name}: ${count}`);
    } catch (e) {
      console.error('Error on', q.name, e.message);
    }
  }
}

test();
