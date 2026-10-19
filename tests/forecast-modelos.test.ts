import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import {limparPrevisoesModelo} from '../src/lib/forecastModeloCarteira.ts'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
test('Modelo deixa meses em branco, preserva histórico e mantém totais sem zeros artificiais',async()=>{
 const w=new ExcelJS.Workbook(),h=w.addWorksheet('Histórico'),s=w.addWorksheet('Forecast')
 h.getCell('C8').value=30;s.getCell('A8').value='Cliente';s.getCell('B8').value='Cliente';s.getCell('F8').value={formula:'SUM(F9:F9)',result:15}
 s.getCell('A9').value='Produto';s.getCell('B9').value='Produto';s.getCell('F9').value=15;s.getCell('G9').value=0;s.getCell('H9').value={formula:'$D9*(1+$E9)',result:35};s.getCell('E9').value=.1;s.getCell('V9').value={formula:'SUM(F9:H9)',result:50}
 const out=new ExcelJS.Workbook();await out.xlsx.load(await limparPrevisoesModelo(new Uint8Array(await w.xlsx.writeBuffer())) as any)
 assert.equal(out.getWorksheet('Histórico')!.getCell('C8').value,30)
 const f=out.getWorksheet('Forecast')!;for(let c=6;c<=20;c++)assert.equal(f.getCell(9,c).value,null)
 assert.equal(f.getCell('E9').value,null);assert.equal(f.getCell('F8').formula,'IF(COUNT(F9:F9)=0,"",SUM(F9:F9))');assert.equal(f.getCell('V9').formula,'IF(COUNT(F9:H9)=0,"",SUM(F9:H9))')
})
test('Modelos são privados, vendedor lê só o próprio, gestão lê todos e ninguém altera pelo cliente',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;grant usage on schema public,private to authenticated;
 create table vendedores(id uuid primary key);
 create function private.has_commercial_overview() returns boolean language sql stable as $$select current_setting('test.perfil',true) in ('ADMIN','GERENTE','DIRETOR')$$;
 create function private.current_vendedor_id() returns uuid language sql stable as $$select nullif(current_setting('test.vendedor',true),'')::uuid$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261016191745_forecast_modelos_carteira.sql',import.meta.url),'utf8'))
 await db.exec(`insert into vendedores values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');insert into forecast_modelos select id,'Forecast_TESTE.xlsx','YQ==','2026' from vendedores;set role authenticated;set test.perfil='VENDEDOR';set test.vendedor='00000000-0000-0000-0000-000000000001';`)
 assert.equal((await db.query('select * from forecast_modelos')).rows.length,1)
 assert.equal((await db.query("select * from forecast_modelos where vendedor_id='00000000-0000-0000-0000-000000000002'")).rows.length,0)
 for(const perfil of ['ADMIN','GERENTE','DIRETOR']){await db.exec(`set test.perfil='${perfil}'`);assert.equal((await db.query('select * from forecast_modelos')).rows.length,2)}
 for(const sql of ["update forecast_modelos set periodo='2099'","delete from forecast_modelos","insert into forecast_modelos select * from forecast_modelos"])await assert.rejects(()=>db.exec(sql),/permission denied/)
 await db.exec("set test.perfil='';set test.vendedor=''");assert.equal((await db.query('select * from forecast_modelos')).rows.length,0)
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from forecast_modelos'),/permission denied/)
 }finally{await db.close()}
})
