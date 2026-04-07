const fs = require('fs');

const xml = fs.readFileSync('c:/tmp/sponte_apagar.xml', 'utf8');
const regex = /<SituacaoParcela>(.*?)<\/SituacaoParcela>/g;
let match;
const set = new Set();
while ((match = regex.exec(xml)) !== null) {
  set.add(match[1]);
}
console.log('Unique SituacaoParcela values:', Array.from(set));
