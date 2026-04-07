const fs = require('fs');

const xml = fs.readFileSync('c:/tmp/sponte_apagar.xml', 'utf8');
const regex = /<wsParcelaPagar>(.*?)<\/wsParcelaPagar>/gs;
let match;
let total = 0;
let count = 0;
const catTotal = {};

while ((match = regex.exec(xml)) !== null) {
  const itemXml = match[1];
  
  const vencMatch = /<Vencimento>(.*?)<\/Vencimento>/.exec(itemXml);
  const dataPagMatch = /<DataPagamento>(.*?)<\/DataPagamento>/.exec(itemXml);
  const valMatch = /<ValorParcela>([\d,.-]+)<\/ValorParcela>/.exec(itemXml);
  const catMatch = /<Categoria>(.*?)<\/Categoria>/.exec(itemXml);
  
  const venc = vencMatch ? vencMatch[1] : '';
  const dataPag = dataPagMatch ? dataPagMatch[1] : '';
  const val = valMatch ? valMatch[1] : '0';
  const cat = catMatch ? catMatch[1] : 'Sem Categoria';
  
  // Only February 2026 Vencimento
  if (venc.includes('/02/2026')) {
    const v = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    total += v;
    count++;
    catTotal[cat] = (catTotal[cat] || 0) + v;
  }
}

console.log('--- Feb 2026 (Vencimento) ---');
console.log('Count:', count);
console.log('Total:', total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}));
console.log(catTotal);
