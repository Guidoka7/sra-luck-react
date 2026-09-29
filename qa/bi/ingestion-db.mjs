// Isolated PostgreSQL/WASM test. No network, credentials, or production data.
// PGLITE_MODULE=/tmp/bi-db-qa/node_modules/@electric-sql/pglite/dist/index.js node qa/bi/ingestion-db.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(await readFile(new URL('../../supabase/migrations/20260929204811_bi_commercial_ingestion.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260929205621_bi_projection_integrity.sql',import.meta.url),'utf8'));
const source=randomUUID(),lease=randomUUID();
const rpc=async(name,args)=>(await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
const count=async(table)=>(await db.query('select count(*)::int as n from '+table)).rows[0].n;
const checkpoint={schema_version:1,index:0,tasks:[{entity:'deals',page:1}],completed:[]};
const record=(id,name='Lead QA',stamp='2026-09-28T00:00:00Z',h='a')=>({external_id:id,data:{id,name},source_updated_at:stamp,payload_hash:h.repeat(64)});
await db.exec('set role service_role');
await rpc('bi_register_source',[source]);
await assert.rejects(rpc('bi_start_run',[source,'commercial',checkpoint,'qa-owner']),/BI_MAPPING_REQUIRED/);
await rpc('bi_save_mapping',[source,0,{version:1,funnels:[]},'qa-owner']);
await assert.rejects(rpc('bi_save_mapping',[source,0,{version:1,funnels:[]},'qa-owner']),/BI_MAPPING_CONFLICT/);
let run=await rpc('bi_start_run',[source,'commercial',checkpoint,'qa-owner']);
assert.equal((await rpc('bi_start_run',[source,'commercial',checkpoint,'qa-owner'])).id,run.id);
await rpc('bi_claim_run',[run.id,lease]);
await assert.rejects(rpc('bi_claim_run',[run.id,randomUUID()]),/BI_RUN_BUSY/);
const batch=randomUUID();
const commit=(records,version=0,done=false,id=batch,h='b')=>rpc('bi_commit_batch',[run.id,lease,version,id,h.repeat(64),'deals',records,{...checkpoint,index:done?1:0},done]);
let result=await commit([record('d1')]);assert.equal(result.changed,1);assert.equal(result.validated,false);
assert.deepEqual(await commit([record('d1')]),result);assert.equal(await count('bi_records'),1);assert.equal(await count('bi_record_versions'),1);
await assert.rejects(commit([record('d1')],0,false,batch,'c'),/BI_BATCH_CONFLICT/);
async function claim(){await db.query('update bi_runs set next_attempt_at=null where id=$1',[run.id]);return rpc('bi_claim_run',[run.id,lease]);}
await claim();
result=await commit([record('d1','Old QA','2026-09-27T00:00:00Z','c')],1,false,randomUUID());assert.equal(result.quarantined,1);
assert.equal((await db.query('select data from bi_records')).rows[0].data.name,'Lead QA');assert.equal((await db.query('select incoming_data from bi_ingestion_issues')).rows[0].incoming_data.name,'Old QA');
await claim();
result=await commit([record('d1','Conflicting QA','2026-09-28T00:00:00Z','d')],2,false,randomUUID());assert.equal(result.quarantined,1);
// Deliberate database failure after an earlier row in the same batch: both record and cursor must roll back.
await claim();
await db.exec("reset role; create function qa_fail_record() returns trigger language plpgsql as $$ begin if new.external_id='fail' then raise exception 'QA_FORCED_FAILURE'; end if; return new; end $$; create trigger qa_fail before insert on bi_records for each row execute function qa_fail_record(); set role service_role;");
await assert.rejects(commit([record('new'),record('fail')],3,false,randomUUID()),/QA_FORCED_FAILURE/);
assert.equal(await count('bi_records'),1);assert.equal((await db.query('select version from bi_runs where id=$1',[run.id])).rows[0].version,3);
await db.exec('reset role; drop trigger qa_fail on bi_records; drop function qa_fail_record(); set role service_role;');
await commit([],3,true,randomUUID());
// A new mapping changes the projection, not the source version. Re-reading is legitimate.
await rpc('bi_save_mapping',[source,1,{version:1,funnels:[]},'qa-owner']);
run=await rpc('bi_start_run',[source,'commercial',checkpoint,'qa-owner']);await rpc('bi_claim_run',[run.id,lease]);
result=await commit([record('d1','Changed native QA','2026-09-28T00:00:00Z','f')],0,false,randomUUID());assert.equal(result.quarantined,1);
await claim();
result=await commit([{...record('d1','Lead QA','2026-09-28T00:00:00Z','e'),data:{id:'d1',name:'Lead QA',custom_fields:{seller:'QA seller'}}}],1,false,randomUUID());assert.equal(result.changed,1);assert.equal(result.quarantined,0);
assert.equal((await db.query('select mapping_version from bi_records')).rows[0].mapping_version,2);
// Failures preserve cursor, respect retry delay and eventually pause.
for(let i=0;i<5;i++){await claim();await rpc('bi_fail_run',[run.id,lease,'BI_RD_HTTP_429',{page:1},30]);}
assert.equal((await db.query('select status,version from bi_runs where id=$1',[run.id])).rows[0].status,'paused');
await assert.rejects(rpc('bi_claim_run',[run.id,lease]),/BI_RUN_BUSY/);await rpc('bi_resume_run',[run.id]);
await db.exec('reset role; set role anon;');
await assert.rejects(db.query('select * from bi_records'),/permission denied/);await assert.rejects(rpc('bi_register_source',[randomUUID()]),/permission denied/);
await db.exec('reset role; set role authenticated;');await assert.rejects(db.query('select * from bi_sources'),/permission denied/);
await db.exec('reset role;');assert.equal((await db.query("select count(*)::int as n from pg_class where relname like 'bi_%' and relkind='r' and relrowsecurity")).rows[0].n,7);
await db.close();console.log('PASS · BI DB: replay, concurrent lease, mapping CAS, quarantine, atomic rollback, projection revision, retry/pause, RLS and RPC grants');
