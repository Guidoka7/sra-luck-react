-- Revisão de projeção só pode mudar campos selecionados, nunca alterar fatos nativos no mesmo timestamp.
create or replace function public.bi_commit_batch(p_run uuid,p_lease uuid,p_version integer,p_batch uuid,p_hash text,p_entity text,p_records jsonb,p_checkpoint jsonb,p_done boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r bi_runs; prior bi_batches; item jsonb; old bi_records; stamp timestamptz; n integer:=0; changed integer:=0; q_count integer:=0; result jsonb; reason text;
begin
 select * into r from bi_runs where id=p_run for update;
 if not found then raise exception 'BI_RUN_UNKNOWN'; end if;
 select * into prior from bi_batches where id=p_batch;
 if found then
  if prior.run_id<>p_run or prior.payload_hash<>p_hash then raise exception 'BI_BATCH_CONFLICT'; end if;
  return prior.result;
 end if;
 if r.version<>p_version or r.status<>'running' then raise exception 'BI_CHECKPOINT_CONFLICT'; end if;
 if r.lease_owner is distinct from p_lease or r.lease_until<now() then raise exception 'BI_LEASE_LOST'; end if;
 if not exists(select 1 from bi_sources where id=r.source_id and active) then raise exception 'BI_SOURCE_NOT_ACTIVE'; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>100 or octet_length(p_records::text)>2000000 then raise exception 'BI_BATCH_INVALID'; end if;
 if p_entity not in ('contacts','deals','meetings','tasks','pipelines','stages','sources','campaigns','users','custom_fields','lost_reasons') then raise exception 'BI_ENTITY_INVALID'; end if;
 for item in select value from jsonb_array_elements(p_records) loop
  n:=n+1;
  if item->>'external_id' is null or item->'data'->>'id' is distinct from item->>'external_id' or item->>'payload_hash' is null or (item->>'payload_hash') !~ '^[a-f0-9]{64}$' then raise exception 'BI_RECORD_INVALID'; end if;
  stamp:=(item->>'source_updated_at')::timestamptz;
  select * into old from bi_records where source_id=r.source_id and entity=p_entity and external_id=item->>'external_id';
  reason:=null;
  if found then
   if stamp is not null and old.source_updated_at is not null and stamp<old.source_updated_at then reason:='STALE_VERSION';
   elsif stamp is not null and stamp=old.source_updated_at and old.payload_hash<>item->>'payload_hash' and (old.mapping_version=r.mapping_version or (old.data-'custom_fields') is distinct from ((item->'data')-'custom_fields')) then reason:='SAME_VERSION_CONFLICT';
   elsif old.source_updated_at is not null and stamp is null and old.payload_hash<>item->>'payload_hash' then reason:='MISSING_SOURCE_VERSION';
   end if;
  end if;
  if reason is not null then
   q_count:=q_count+1;
   insert into bi_ingestion_issues(source_id,entity,external_id,code,details,incoming_data) values(r.source_id,p_entity,item->>'external_id',reason,jsonb_build_object('run_id',p_run,'incoming_updated_at',stamp,'stored_updated_at',old.source_updated_at,'mapping_version',r.mapping_version),item->'data')
   on conflict(source_id,entity,external_id,code) do update set last_seen_at=now(),details=excluded.details,incoming_data=excluded.incoming_data;
  else
   if old.payload_hash is distinct from item->>'payload_hash' then
    changed:=changed+1;
    insert into bi_record_versions(source_id,entity,external_id,data,payload_hash,source_updated_at,mapping_version,run_id) values(r.source_id,p_entity,item->>'external_id',item->'data',item->>'payload_hash',stamp,r.mapping_version,p_run);
   end if;
   insert into bi_records(source_id,entity,external_id,data,payload_hash,source_updated_at,mapping_version,last_run_id) values(r.source_id,p_entity,item->>'external_id',item->'data',item->>'payload_hash',stamp,r.mapping_version,p_run)
   on conflict(source_id,entity,external_id) do update set data=excluded.data,payload_hash=excluded.payload_hash,source_updated_at=coalesce(excluded.source_updated_at,bi_records.source_updated_at),mapping_version=r.mapping_version,observed_at=now(),last_run_id=p_run;
  end if;
 end loop;
 result:=jsonb_build_object('run_id',p_run,'batch_id',p_batch,'received',n,'changed',changed,'quarantined',q_count,'version',p_version+1,'cursor_committed',true,'collected',p_done,'validated',false);
 insert into bi_batches(id,run_id,version,payload_hash,result) values(p_batch,p_run,p_version,p_hash,result);
 update bi_runs set checkpoint=p_checkpoint,version=version+1,received=received+n,quarantined=bi_runs.quarantined+q_count,
 status=case when p_done then 'collected' else 'running' end,finished_at=case when p_done then now() else null end,
 failures=0,last_error=null,error_details=null,lease_owner=null,lease_until=null,next_attempt_at=now()+interval '1 second',updated_at=now() where id=p_run;
 return result;
end $$;

