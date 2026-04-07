const fs = require('fs');

async function test() {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelas';
  
  const situations = ['Paga', 'Quitada', 'Cancelada', 'Pagas'];
  for (const sit of situations) {
    const params = new URLSearchParams({ 
      nCodigoCliente: '35695', 
      sToken: 'fxW1Et2vS8Vf', 
      sParametrosBusca: `Situacao=${sit}&DataInicial=01/01/2025&DataFinal=31/12/2026` 
    });

    try {
      const res = await fetch(`${url}?${params.toString()}`).then(r => r.text());
      const count = (res.match(/<wsParcela>/g) || []).length;
      
      const regex = /<SituacaoParcela>(.*?)<\/SituacaoParcela>/g;
      let match;
      const set = new Set();
      while ((match = regex.exec(res)) !== null) {
        set.add(match[1]);
      }
      console.log(`Test: Situacao=${sit} | Total: ${count} | Situacoes:`, Array.from(set));
      
    } catch (e) {
      console.error(`Error on ${sit}:`, e.message);
    }
  }
}

test();
