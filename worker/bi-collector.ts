import { createServiceSupabaseClient, type Env } from './supabase';
import { BI_ENTITIES, BI_CATALOG_ENTITIES, UUID, object, validateMapping, validateRecords } from './bi-ingestion-contract';
const json=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function id(value: unknown): string { if(typeof value!=='string'||!UUID.test(value))throw new Error('BI_ID_INVALID');return value; }
function checkpoint(value: unknown) { if(!object(value)||value.schema_version!==1||JSON.stringify(value).length>64000)throw new Error('BI_CHECKPOINT_INVALID'); return value; }
function int(value: unknown,max=100000000) { if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>max)throw new Error('BI_INTEGER_INVALID');return value; }
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join(''); }
export async function collectorStatus(env: Env,sourceId?: string) {
 const db=createServiceSupabaseClient(env);
 const query=db.from('bi_sources').select('id,provider,active,mapping_version,mapping,created_at').eq('active',true);
 if(sourceId)query.eq('id',sourceId);
 const {data:source,error}=await query.maybeSingle();
 if(error)throw new Error('BI_STORAGE_UNAVAILABLE');
 if(!source)return {source:null,runs:[],counts:{},issues:0};
 const [{data:runs,error:runError},{count:issues,error:issueError},counts]=await Promise.all([
  db.from('bi_runs').select('id,mode,status,version,received,quarantined,failures,last_error,error_details,next_attempt_at,started_at,updated_at,finished_at,mapping_version').eq('source_id',source.id).order('started_at',{ascending:false}).limit(20),
  db.from('bi_ingestion_issues').select('*',{count:'exact',head:true}).eq('source_id',source.id),
  Promise.all(BI_ENTITIES.map(async entity=>{const r=await db.from('bi_records').select('*',{count:'exact',head:true}).eq('source_id',source.id).eq('entity',entity);if(r.error)throw new Error('BI_STORAGE_UNAVAILABLE');return [entity,r.count??0] as const;}))
 ]);
 if(runError||issueError)throw new Error('BI_STORAGE_UNAVAILABLE');
 return {source,runs:runs??[],counts:Object.fromEntries(counts),issues:issues??0};
}
export async function biCollector(request: Request,env: Env,actor: string) {
 const url=new URL(request.url);const action=url.pathname.split('/').pop();
 try {
  const db=createServiceSupabaseClient(env);
  if(request.method==='GET') {
   if(action==='status')return json(await collectorStatus(env,url.searchParams.has('source')?id(url.searchParams.get('source')):undefined));
   if(action==='catalog') {
    const source=id(url.searchParams.get('source'));const entity=url.searchParams.get('entity')??'';const offset=int(Number(url.searchParams.get('offset')??0));
    if(!(BI_CATALOG_ENTITIES as readonly string[]).includes(entity))throw new Error('BI_ENTITY_INVALID');
    const {data,error}=await db.from('bi_records').select('external_id,data').eq('source_id',source).eq('entity',entity).order('external_id').range(offset,offset+99);
    if(error)throw new Error('BI_STORAGE_UNAVAILABLE');return json({records:data??[],nextOffset:data?.length===100?offset+100:null});
   }
   if(action==='issues') {
    const source=id(url.searchParams.get('source'));const offset=int(Number(url.searchParams.get('offset')??0));
    const {data,error}=await db.from('bi_ingestion_issues').select('entity,external_id,code,details,last_seen_at').eq('source_id',source).order('last_seen_at',{ascending:false}).range(offset,offset+99);
    if(error)throw new Error('BI_STORAGE_UNAVAILABLE');return json({records:data??[],nextOffset:data?.length===100?offset+100:null});
   }
   return json({erro:'Rota não encontrada.'},404);
  }
  if(request.method!=='POST')return json({erro:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')??0)>2000000)return json({erro:'Lote muito grande.'},413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>2000000)return json({erro:'Lote muito grande.'},413);
  let input;try{input=JSON.parse(raw)}catch{return json({erro:'JSON inválido.'},400)}
  if(!object(input))throw new Error('BI_REQUEST_INVALID');
  let rpc:string;let args:Record<string,unknown>;
  if(action==='register') {rpc='bi_register_source';args={p_source:id(input.source_id)};}
  else if(action==='mapping') {rpc='bi_save_mapping';args={p_source:id(input.source_id),p_expected:int(input.expected_version),p_mapping:validateMapping(input.mapping),p_actor:actor};}
  else if(action==='start') {
   if(!['catalog','commercial'].includes(input.mode))throw new Error('BI_MODE_INVALID');
   rpc='bi_start_run';args={p_source:id(input.source_id),p_mode:input.mode,p_checkpoint:checkpoint(input.checkpoint),p_actor:actor};
  } else if(action==='claim') {rpc='bi_claim_run';args={p_run:id(input.run_id),p_lease:id(input.lease)};}
  else if(action==='resume') {rpc='bi_resume_run';args={p_run:id(input.run_id)};}
  else if(action==='fail') {
   if(typeof input.code!=='string'||!/^BI_[A-Z0-9_]{1,90}$/.test(input.code))throw new Error('BI_ERROR_INVALID');
   const details=object(input.details)?input.details:{};
   if(Object.keys(details).some(k=>!['entity','page','recordId','reason'].includes(k))||JSON.stringify(details).length>1500)throw new Error('BI_ERROR_INVALID');
   rpc='bi_fail_run';args={p_run:id(input.run_id),p_lease:id(input.lease),p_code:input.code,p_details:details,p_retry:int(input.retry_after??30,86400)};
  } else if(action==='commit') {
   const records=validateRecords(input.records);
   if(!(BI_ENTITIES as readonly string[]).includes(input.entity)||typeof input.done!=='boolean')throw new Error('BI_BATCH_INVALID');
   for(const record of records)if(await hash(JSON.stringify(record.data))!==record.payload_hash)throw new Error('BI_RECORD_HASH_INVALID');
   rpc='bi_commit_batch';args={p_run:id(input.run_id),p_lease:id(input.lease),p_version:int(input.expected_version),p_batch:id(input.batch_id),p_hash:await hash(JSON.stringify({entity:input.entity,records,checkpoint:input.checkpoint,done:input.done})),p_entity:input.entity,p_records:records,p_checkpoint:checkpoint(input.checkpoint),p_done:input.done};
  } else return json({erro:'Rota não encontrada.'},404);
  const {data,error}=await db.rpc(rpc,args);
  if(error){const code=String(error.message).match(/BI_[A-Z0-9_]+/)?.[0]??'BI_STORAGE_UNAVAILABLE';throw new Error(code);}
  return json({ok:true,result:data});
 } catch(e) {
  const code=e instanceof Error&&/^BI_[A-Z0-9_]+$/.test(e.message)?e.message:'BI_STORAGE_UNAVAILABLE';
  const status=/CONFLICT|BUSY|PAUSED|LEASE|OTHER_RUN/.test(code)?409:/INVALID|REQUIRED/.test(code)?400:503;
  return json({erro:'A operação do coletor não foi concluída.',codigo:code},status);
 }
}
