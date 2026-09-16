// Teste local com API simulada; nunca acessa o projeto de produção.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import assert from 'node:assert/strict'
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const user={id:id(1),nome:'ADMIN teste',email:'admin@example.invalid',perfil:'ADMIN',ativo:true,vendedor_id:null}
const customer={id:id(2),codigo:'000123',razao_social:'CLIENTE SP',uf:'SP',ativo:true,vendedor_id:id(3)}
const product={id:id(4),nome:'PRODUTO TESTE',codigo_protheus:'ABC',ncm:'32129010',colour_index:'Pigment Blue 15:3',ativo:true,status_fiscal:'AUTOMATICO',precos:[]}
const branches=[{id:id(5),codigo:'0102',nome:'SC - ITAJAI',uf:'SC'}]
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROMIUM_PATH ? {executablePath:process.env.TEST_CHROMIUM_PATH,args:JSON.parse(process.env.TEST_CHROMIUM_ARGS||'[]')} : {})});const page=await browser.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
let savedQuote,savedOrder,calcs=0
await page.route('https://build-validation.invalid/**',async route=>{
 const path=new URL(route.request().url()).pathname.split('/').pop();let body=[]
 if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}})
 if(path==='usuarios')body=user
 if(path==='clientes')body=[customer]
 if(path==='produtos')body=[product]
 if(path==='filiais')body=branches
 if(path==='configuracoes')body={chave:'PTAX_VALOR',valor:5.1}
 if(path==='vendedores')body=[{id:id(3),nome:'Vendedor'}]
 if(path==='calcular_preco_comercial'){
  calcs++;const b=route.request().postDataJSON();const div=.8712;const final=b.p_preco_final!=null?b.p_preco_final:Math.round(b.p_preco_net/div*100)/100
  body={automatico:true,divisor:div,aliquota:.04,preco_final:final,preco_net:b.p_preco_final!=null?Math.round(final*div*10000)/10000:b.p_preco_net,ipi:.065,filial_origem_id:id(5),ncm:product.ncm,colour_index:product.colour_index}
 }
 if(path==='criar_cotacao_v2'){savedQuote=route.request().postDataJSON();body={id:id(7),numero:'COT-TESTE'}}
 if(path==='criar_pedido_v4'){savedOrder=route.request().postDataJSON();body={numero:'PED-TESTE'}}
 await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','content-range':'0-0/1'},body:JSON.stringify(body)})
})
await page.addInitScript(({user})=>{
 const exp=Math.floor(Date.now()/1000)+3600
 localStorage.setItem('sb-build-validation-auth-token',JSON.stringify({access_token:`e30.${btoa(JSON.stringify({sub:user.id,exp}))}.mock`,refresh_token:'mock',expires_at:exp,expires_in:3600,token_type:'bearer',user}))
},{user})
const field=label=>page.locator(`.field:has(> label:text-is("${label}")) input`)
async function choose(){await page.getByPlaceholder('Pesquise qualquer cliente...').fill('CLIENTE');await page.getByRole('button',{name:/000123/}).click();await page.getByPlaceholder('Comece a digitar o nome ou código do produto...').fill('PRODUTO');await page.getByRole('button',{name:/PRODUTO TESTE ABC/}).click()}
try{
 await page.goto('http://127.0.0.1:4173')
 await page.getByRole('button',{name:'＋ Nova Cotação / Lista'}).click()
 await field('Título da cotação / lista de preço *').fill('Lista sem quantidade')
 assert.equal(await page.locator('label:text-is("Filial *")').count(),0)
 await choose()
 await field('Preço final (sem IPI) *').fill('28.75')
 await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='25.0470'))
 assert.equal(await field('Preço NET *').inputValue(),'25.0470')
 await page.getByRole('button',{name:'Adicionar produto à cotação'}).click()
 await page.getByRole('button',{name:'Salvar Cotação / Lista'}).click()
 await page.getByText(/COT-TESTE salva/).waitFor()
 assert.equal(savedQuote.p_itens[0].quantidade,null);assert.equal(savedQuote.p_itens[0].preco_net,25.047);assert.equal(savedQuote.p_itens[0].entrada_preco,'FINAL')
 await choose();await field('Preço NET *').fill('25.05')
 await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='28.75'))
 assert.equal(await field('Preço final (sem IPI) *').inputValue(),'28.75')
 await page.getByRole('button',{name:'＋ Novo Pedido',exact:true}).click();await choose()
 assert.equal(await page.locator('label:text-is("Filial *")').count(),1)
 await field('Preço final (sem IPI) *').fill('28.75')
 await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='25.0470'))
 await page.getByRole('button',{name:'Adicionar produto ao pedido'}).click()
 await page.getByText('Informe a quantidade.',{exact:true}).waitFor()
 await field('Quantidade *').fill('25');await page.getByRole('button',{name:'Adicionar produto ao pedido'}).click()
 await page.getByRole('button',{name:'Salvar Pedido no Supabase'}).click()
 await page.getByText(/PED-TESTE gravado/).waitFor()
 assert.equal(savedOrder.p_itens[0].preco_net,25.047);assert.equal(savedOrder.p_itens[0].quantidade,25)
 assert.ok(calcs<12,'Cálculo entrou em ciclo');assert.deepEqual(errors,[])
 console.log('PASS: cotação sem filial/quantidade, NET ↔ final, pedido com quantidade, sem ciclo ou erro de página.')
}finally{await browser.close()}
