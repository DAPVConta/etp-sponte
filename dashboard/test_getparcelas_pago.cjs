const axios = require('axios');
const fs = require('fs');

async function test() {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelas';
  const params = new URLSearchParams({ 
    nCodigoCliente: '35695', 
    sToken: 'fxW1Et2vS8Vf', 
    sParametrosBusca: 'Situacao=Pago' 
  });

  try {
    const res = await fetch(`${url}?${params.toString()}`).then(r => r.text());
    
    fs.writeFileSync('c:/tmp/sponte_getparcelas_pago.xml', res);
    
    if (res.includes('<error>')) {
      console.log('API returned an error:', res);
      return;
    }
    
    const count = (res.match(/<wsParcela>/g) || []).length;
    console.log(`Saved c:/tmp/sponte_getparcelas_pago.xml`);
    console.log(`Total <wsParcela> elements returned: ${count}`);
    
    // Check what exact situations are in the response
    const regex = /<SituacaoParcela>(.*?)<\/SituacaoParcela>/g;
    let match;
    const set = new Set();
    while ((match = regex.exec(res)) !== null) {
      set.add(match[1]);
    }
    console.log('Unique SituacaoParcela values found in response:', Array.from(set));
    
  } catch (e) {
    console.error('Error fetching API:', e.message);
  }
}

test();
