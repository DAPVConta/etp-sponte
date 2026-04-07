const fs = require('fs');

const xml = fs.readFileSync('c:/tmp/sponte_wsdl.xml', 'utf8');
const regex = /<s:element name="([^"]+)"/g;
let match;
const set = new Set();
while ((match = regex.exec(xml)) !== null) {
  set.add(match[1]);
}
const arr = Array.from(set).filter(n => !n.includes('Response'));
console.log('Available Methods:\n' + arr.join('\n'));
