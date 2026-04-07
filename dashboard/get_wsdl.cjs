const fs = require('fs');

async function test() {
  const url = 'http://api.sponteeducacional.net.br/WSAPIEdu.asmx?WSDL';

  try {
    const res = await fetch(url).then(r => r.text());
    fs.writeFileSync('c:/tmp/sponte_wsdl.xml', res);
    console.log('Saved WSDL');
  } catch (e) {
    console.error('Error', e.message);
  }
}

test();
