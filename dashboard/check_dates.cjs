const fs = require('fs');

const xml = fs.readFileSync('c:/tmp/sponte_apagar.xml', 'utf8');
const regex = /<wsParcelaPagar>(.*?)<\/wsParcelaPagar>/gs;
let match;
const dates = new Set();
let count = 0;

while ((match = regex.exec(xml)) !== null) {
  const vencMatch = /<Vencimento>(.*?)<\/Vencimento>/.exec(match[1]);
  if (vencMatch) {
    const v = vencMatch[1];
    dates.add(v.substring(3)); // Add MM/YYYY
    if (v.includes('/02/2026')) count++;
  }
}
console.log('Unique months:', Array.from(dates));
console.log('Count Feb 2026:', count);
