import requests

url = "http://api.sponteeducacional.net.br/WSAPIEdu.asmx/GetParcelasPagar"

formats = [
    'data_inicial=01/02/2026&data_final=28/02/2026',
    'dataInicial=01/02/2026&dataFinal=28/02/2026',
    'inicio=01/02/26&fim=28/02/26',
    '01/02/2026,28/02/2026',
    '01/02/26 - 28/02/26',
    'anoCobranca=2026'
]

for f in formats:
    payload = {
        'nCodigoCliente': '35695',
        'sToken': 'fxW1Et2vS8Vf',
        'sParametrosBusca': f
    }
    
    response = requests.post(url, data=payload)
    print(f"Format: {f}")
    if response.status_code == 200:
        print("SUCCESS!")
        print(response.text[:200])
        break
    else:
        print("STATUS:", response.status_code)
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(response.text)
            print("ERROR XML:", root.text)
        except:
            print("ERROR RAW:", response.text[:200].replace('\n', ' '))
    print("-" * 40)
