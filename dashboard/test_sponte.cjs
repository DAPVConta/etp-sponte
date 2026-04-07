const axios = require('axios');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar';
  const paramsList = [
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'data_inicial=01/02/2026&data_final=28/02/2026' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'dataInicial=01/02/2026&dataFinal=28/02/2026' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: '01/02/2026,28/02/2026' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'dataVencimentoInicial=01/02/2026&dataVencimentoFinal=28/02/2026' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: 'vencimento_inicial=01/02/2026&vencimento_final=28/02/2026' },
    { nCodigoCliente: '35695', sToken: 'fxW1Et2vS8Vf', sParametrosBusca: '' } // Try empty
  ];

  for (const params of paramsList) {
    try {
      console.log('Testing GET:', params.sParametrosBusca);
      const res = await axios.get(url, { params });
      console.log('GET SUCCESS', res.data.substring(0, 150));
      return;
    } catch (e) {
      console.log('GET ERROR 500');
    }
  }

  for (const params of paramsList) {
    try {
      console.log('Testing POST:', params.sParametrosBusca);
      const res = await axios.post(url, new URLSearchParams(params).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('POST SUCCESS', res.data.substring(0, 150));
      return;
    } catch (e) {
      console.log('POST ERROR 500');
    }
  }
}

test();
