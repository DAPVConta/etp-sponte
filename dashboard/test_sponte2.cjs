const axios = require('axios');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const paramsList = [
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'Situacao=A Pagar' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'Situacao=Em Aberto' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'Situacao=A Pagar&DataInicial=01/02/2026&DataFinal=28/02/2026' },
  ];

  for (const params of paramsList) {
    try {
      console.log('Testing GET:', params.sParametrosBusca);
      const res = await axios.get(url, { params });
      console.log('GET SUCCESS length:', res.data.length);
      if (res.data.length > 500) {
        console.log('Sample:', res.data.substring(0, 300));
      } else {
        console.log('Response:', res.data);
      }
    } catch (e) {
      console.log('GET ERROR 500');
    }
  }
}

test();
