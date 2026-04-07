const fs = require('fs');

async function test() {
  const url = 'https://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetCategoriasDespesas';
  const params = new URLSearchParams({ 
    nCodigoCliente: '35695', 
    sToken: 'fxW1Et2vS8Vf' 
  });

  try {
    const res = await fetch(`${url}?${params.toString()}`).then(r => r.text());
    
    fs.writeFileSync('c:/tmp/sponte_categorias_desp.xml', res);
    
    if (res.includes('<error>')) {
      console.log('API returned an error:', res);
      return;
    }
    
    // Parse the XML to extract Categorias
    const regex = /<Categorias>(.*?)<\/Categorias>/gs;
    let match;
    const items = [];
    while ((match = regex.exec(res)) !== null) {
      const itemXml = match[1];
      const idMatch = /<CategoriaID>(.*?)<\/CategoriaID>/.exec(itemXml);
      const nomeMatch = /<Nome>(.*?)<\/Nome>/.exec(itemXml);
      if (idMatch && nomeMatch) {
         items.push({ id: idMatch[1], nome: nomeMatch[1] });
      }
    }
    
    console.log(`| ID | Categoria |`);
    console.log(`|---|---|`);
    for (const item of items) {
      console.log(`| ${item.id} | ${item.nome} |`);
    }

  } catch (e) {
    console.error('Error fetching API:', e.message);
  }
}

test();
