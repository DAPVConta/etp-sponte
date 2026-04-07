const fs = require('fs');

function parseAndSum(file) {
  if (!fs.existsSync(file)) return console.log(file, 'does not exist');
  const xml = fs.readFileSync(file, 'utf8');
  
  if (xml.includes('<error')) {
    console.log(file, 'returned an error!');
    return;
  }
  
  const regex = /<wsParcelaPagar>(.*?)<\/wsParcelaPagar>/gs;
  let match;
  let total = 0;
  let count = 0;

  while ((match = regex.exec(xml)) !== null) {
    const itemXml = match[1];
    const valMatch = /<ValorParcela>([\d,.-]+)<\/ValorParcela>/.exec(itemXml);
    if (valMatch) {
      const valStr = valMatch[1].replace(/\./g, '').replace(',', '.');
      total += parseFloat(valStr) || 0;
      count++;
    }
  }
  
  console.log(`${file}: Count=${count}, Total=${total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}`);
}

parseAndSum('c:/tmp/sponte_apagar.xml');
parseAndSum('c:/tmp/sponte_paga.xml');
parseAndSum('c:/tmp/sponte_pagamento.xml');
parseAndSum('c:/tmp/sponte_cancelada.xml');
