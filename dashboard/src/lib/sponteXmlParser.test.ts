// Testes de caracterizacao dos parsers de XML da API Sponte (WSAPIEdu).
// Congelam o comportamento atual antes de qualquer refactor — se algum
// destes testes quebrar, o parsing em producao mudou.
import { describe, it, expect } from 'vitest';
import {
  parseCategoriasReceitasXML,
  parseCategoriasDespesasXML,
  parseParcelasReceberXML,
} from './sponteXmlParser';

const xmlCategorias = `<?xml version="1.0" encoding="utf-8"?>
<ArrayOfWsCategorias xmlns="http://api.sponteeducacional.net.br/">
  <wsCategorias>
    <Categorias>
      <CategoriaID>10</CategoriaID>
      <Nome>Mensalidade</Nome>
    </Categorias>
    <Categorias>
      <CategoriaID>7</CategoriaID>
      <Nome>Água Mineral</Nome>
    </Categorias>
    <Categorias>
      <CategoriaID>0</CategoriaID>
      <Nome>Invalida (id zero)</Nome>
    </Categorias>
    <Categorias>
      <CategoriaID>99</CategoriaID>
      <Nome></Nome>
    </Categorias>
  </wsCategorias>
</ArrayOfWsCategorias>`;

describe('parseCategoriasReceitasXML / parseCategoriasDespesasXML', () => {
  it('extrai apenas categorias com id > 0 e nome preenchido', () => {
    const cats = parseCategoriasReceitasXML(xmlCategorias);
    expect(cats).toHaveLength(2);
    expect(cats.map(c => c.categoriaID).sort((a, b) => a - b)).toEqual([7, 10]);
  });

  it('ordena por nome com collation pt-BR (acentos junto das letras base)', () => {
    const cats = parseCategoriasReceitasXML(xmlCategorias);
    expect(cats[0].nome).toBe('Água Mineral');
    expect(cats[1].nome).toBe('Mensalidade');
  });

  it('despesas usa o mesmo schema', () => {
    const cats = parseCategoriasDespesasXML(xmlCategorias);
    expect(cats).toHaveLength(2);
  });

  it('retorna [] para XML malformado', () => {
    expect(parseCategoriasReceitasXML('<<<nao é xml')).toEqual([]);
  });

  it('retorna [] para XML sem categorias', () => {
    expect(parseCategoriasReceitasXML('<root></root>')).toEqual([]);
  });
});

const xmlParcelas = `<?xml version="1.0" encoding="utf-8"?>
<ArrayOfWsParcela>
  <wsParcela>
    <ContaReceberID>12345</ContaReceberID>
    <NumeroParcela>1/12</NumeroParcela>
    <Sacado>JOÃO DA SILVA</Sacado>
    <SituacaoParcela>Pago</SituacaoParcela>
    <SituacaoCNAB></SituacaoCNAB>
    <Vencimento>15/06/2026</Vencimento>
    <ValorParcela>1.234,56</ValorParcela>
    <Categoria>Mensalidade</Categoria>
    <ContaID>9</ContaID>
    <AlunoID>777</AlunoID>
    <FaturaID></FaturaID>
    <NumeroBoleto>555</NumeroBoleto>
    <TipoRecebimento>Boleto</TipoRecebimento>
    <FormaCobranca>PJBANK</FormaCobranca>
    <BolsaAssociada></BolsaAssociada>
    <DataPagamento>15/06/2026 10:30:00</DataPagamento>
    <ValorPago>1.234,56</ValorPago>
    <RetornoOperacao>OK</RetornoOperacao>
  </wsParcela>
  <wsParcela>
    <ContaReceberID>67890</ContaReceberID>
    <NumeroParcela>1/1</NumeroParcela>
    <Sacado>MARIA</Sacado>
    <SituacaoParcela>A Receber</SituacaoParcela>
    <Vencimento>30/06/2026</Vencimento>
    <ValorParcela>50,00</ValorParcela>
    <ValorPago></ValorPago>
    <Categoria>Taxa</Categoria>
  </wsParcela>
</ArrayOfWsParcela>`;

describe('parseParcelasReceberXML', () => {
  it('extrai todas as wsParcela com campos string e numericos', () => {
    const parcelas = parseParcelasReceberXML(xmlParcelas);
    expect(parcelas).toHaveLength(2);

    const p = parcelas[0];
    expect(p.ContaReceberID).toBe('12345');
    expect(p.Sacado).toBe('JOÃO DA SILVA');
    expect(p.SituacaoParcela).toBe('Pago');
    expect(p.DataPagamento).toBe('15/06/2026 10:30:00');
  });

  it('converte valores pt-BR ("1.234,56" → 1234.56)', () => {
    const parcelas = parseParcelasReceberXML(xmlParcelas);
    expect(parcelas[0].ValorParcela).toBe(1234.56);
    expect(parcelas[0].ValorPago).toBe(1234.56);
    expect(parcelas[1].ValorParcela).toBe(50);
  });

  it('valor vazio vira 0', () => {
    const parcelas = parseParcelasReceberXML(xmlParcelas);
    expect(parcelas[1].ValorPago).toBe(0);
  });

  it('campos ausentes viram string vazia', () => {
    const parcelas = parseParcelasReceberXML(xmlParcelas);
    expect(parcelas[1].NumeroBoleto).toBe('');
    expect(parcelas[1].BolsaAssociada).toBe('');
  });

  it('retorna [] para XML malformado', () => {
    expect(parseParcelasReceberXML('<<<')).toEqual([]);
  });
});
