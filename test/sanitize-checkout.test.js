import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCheckout } from '../scripts/lib/tema-harness.mjs';

// Capturas de apresentação do checkout: nenhum dado pessoal pode chegar ao navegador. Dados abaixo são inventados (formato real, pessoa nenhuma).
const CONTACT = '<input type="email" value="fulana.teste@example.org" name="user[email]"><input value="Fulana" name="user[first_name]"><input value="D&#39;Teste" name="user[last_name]">' +
  '<input value="(11) 98888-7777" name="user[phone]"><input value="123.456.789-09" name="user[document]"><input value="01310-100" name="cart[cep]">' +
  '<input value="Avenida Inventada" name="cart[shipping_address][street]"><input value="1000" name="cart[shipping_address][number]">' +
  '<input value="Bairro Inventado" name="cart[shipping_address][neighbourhood]"><input value="Cidade Inventada" name="cart[shipping_address][city]">' +
  '<p>Fulana D&#39;Teste</p><p>Avenida Inventada, 1000</p><p>Bairro Inventado, Cidade Inventada - SP</p><li>Entrega para 01310-100</li><i data-cep="01310100">11988887777</i>' +
  '<b>R$ 1000,00</b><span>até 26/10/2026</span>';

test('sanitizeCheckout: troca contato e endereço (atributos, textos, só dígitos) por fictícios; preços e datas intactos', () => {
  const { html, learned } = sanitizeCheckout(CONTACT);
  for (const real of ['fulana.teste@example.org', 'Fulana', 'Teste', '98888-7777', '123.456.789-09', '01310-100', '01310100', '11988887777', 'Avenida Inventada', 'Bairro Inventado', 'Cidade Inventada', ', 1000']) {
    assert.ok(!html.includes(real), 'sobrou: ' + real);
  }
  assert.ok(html.includes('value="cliente@exemplo.com"') && html.includes('Rua Exemplo, 100') && html.includes('Entrega para 88000-000'));
  assert.ok(html.includes('R$ 1000,00') && html.includes('até 26/10/2026'), 'preço e prazo não são dados pessoais');
  // A tela de pagamento só traz o endereço em texto: vale o que foi aprendido na de contato.
  const pay = sanitizeCheckout('<p>Avenida Inventada, 1000</p><p>Bairro Inventado, Cidade Inventada - SP</p><p>Entrega para 01310-100</p>', learned).html;
  assert.equal(pay, '<p>Rua Exemplo, 100</p><p>Centro, Cidade Exemplo - SP</p><p>Entrega para 88000-000</p>');
});

test('sanitizeCheckout: recusa a captura quando não aprendeu nada ou quando sobra um CEP no texto', () => {
  assert.throws(() => sanitizeCheckout('<p>Avenida Inventada, 1000</p>'), /recusada/);
  assert.throws(() => sanitizeCheckout(CONTACT + '<p>Entrega para 04567-000</p>'), /CEP real/);
});
