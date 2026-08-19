import { describe, it, expect } from "vitest";
import { fixJSON } from "../server/server";

describe("fixJSON", () => {
  it("deve manter JSON válido inalterado", () => {
    const input = '{"isNotaFiscal":true,"notaNumber":"123","companyName":"EMPRESA","valor":150.50,"documentType":"nota_fiscal"}';
    expect(fixJSON(input)).toBe(input);
  });

  it("deve corrigir aspas simples para duplas", () => {
    const input = "{'isNotaFiscal':false,'companyName':'Loja'}";
    const expected = '{"isNotaFiscal":false,"companyName":"Loja"}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve corrigir chaves sem aspas", () => {
    const input = '{isNotaFiscal:false, companyName:"Loja"}';
    const expected = '{"isNotaFiscal":false,"companyName":"Loja"}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgula antes de ]", () => {
    const input = '{"items":[1,2,3,]}';
    const expected = '{"items":[1,2,3]}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgula antes de }", () => {
    const input = '{"a":1,"b":2,}';
    const expected = '{"a":1,"b":2}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgulas duplicadas", () => {
    const input = '{"a":1,,,"b":2}';
    const expected = '{"a":1,"b":2}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve corrigir número formato brasileiro com separador de milhar e decimal (2.707,22)", () => {
    const input = '{"valor":2.707,22,"documentType":"folha_pagamento"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(2707.22);
  });

  it("deve manter números com ponto decimal inalterados", () => {
    const input = '{"valor":134.01}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(134.01);
  });

  it("deve corrigir documentos múltiplos com valor brasileiro no segundo", () => {
    const input = '[{"isNotaFiscal":false,"companyName":"EMPRESA","valor":134.01},{"isNotaFiscal":false,"companyName":"PREFEITURA","valor":2.707,22}]';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].valor).toBe(134.01);
    expect(parsed[1].valor).toBe(2707.22);
  });

  it("deve remover caracteres de controle", () => {
    const input = '{"a":1\x00\x01\x02}';
    const result = fixJSON(input);
    expect(result).toBe('{"a":1}');
  });

  it("deve remover espaços extras no início/fim", () => {
    const input = '  {"a":1}  ';
    const result = fixJSON(input);
    expect(result).toBe('{"a":1}');
  });

  it("deve corrigir JSON com array de objetos", () => {
    const input = ' [ { "a" : 1 } , { "b" : 2 } ] ';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("não deve quebrar array com espaço entre elementos", () => {
    const input = '{"items":[1, 5, 10]}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual([1, 5, 10]);
  });

  // Casos reais do QA com custeio-municipal-12-25
  it("deve converter 5.425,00 para 5425.00 (QA real)", () => {
    const input = '{"isNotaFiscal":true,"notaNumber":"1244","companyName":"Departamento de Tributacao","valor":5.425,00,"pessoaNome":null,"documentType":"nota_fiscal"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(5425.00);
  });

  it("deve converter 913,00 para 913.00 (QA real)", () => {
    const input = '{"isNotaFiscal":true,"notaNumber":"1352540002175940","companyName":"CECILIA GOBBO PAPELARIA ME","valor":913,00,"pessoaNome":null,"documentType":"nota_fiscal"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(913.00);
  });

  it("deve converter 151,44 para 151.44 (QA real)", () => {
    const input = '{"isNotaFiscal":true,"notaNumber":"001716489","companyName":"Cacola Embalagens Ltda.","valor":151,44,"pessoaNome":null,"documentType":"nota_fiscal"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(151.44);
  });

  it("não deve converter [1,2,3] para [1.2,3] (array de inteiros)", () => {
    const input = '{"items":[1,2,3]}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  it("deve corrigir 1.234,56 sem espaço após vírgula", () => {
    const input = '{"valor":1.234,56,"nome":"teste"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(1234.56);
    expect(parsed.nome).toBe("teste");
  });
});
