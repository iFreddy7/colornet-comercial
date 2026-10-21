import test from 'node:test'
import assert from 'node:assert/strict'
import { pesoEmbalagem,descricaoEmbalagem } from '../src/lib/embalagens.ts'
test('Embalagem usa o sufixo cadastrado, preservando variantes e IBC',()=>{
 assert.equal(pesoEmbalagem('OR001.2SC25'),25)
 assert.equal(pesoEmbalagem('OR001.7SC25'),25)
 assert.equal(pesoEmbalagem('PE001CX03'),3)
 assert.equal(pesoEmbalagem('AD010.2IBCK'),1000)
 assert.equal(pesoEmbalagem('abcTB180'),180)
 assert.equal(descricaoEmbalagem('OR001.2SC25'),'Embalagem: 25 kg')
})
test('Não inventa tamanho para código ausente ou não cadastrado',()=>{
 for(const codigo of [null,'','ABC.CX99','ABC.SC250']) assert.equal(pesoEmbalagem(codigo),null)
})

