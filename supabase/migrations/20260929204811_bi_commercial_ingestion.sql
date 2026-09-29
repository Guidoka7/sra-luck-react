-- BI comercial: armazenamento separado das tabelas operacionais. Sem alterações em clientes/parcelas.
create table public.bi_sources (
 id uuid primary key, provider text not null check(provider='rd_station'), active boolean not null default true,
 mapping_version integer not null default 0, mapping jsonb not null default '{"version":1,"funnels":[]}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index bi_one_active_provider on public.bi_sources(provider) where active;
create table public.bi_mapping_versions (
 source_id uuid not null references public.bi_sources(id), version integer not null, mapping jsonb not null,
 actor text not null, created_at timestamptz not null default now(), primary key(source_id,version)
);
create table public.bi_runs (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references public.bi_sources(id),
 mode text not null check(mode in ('catalog','commercial')), status text not null default 'running' check(status in ('running','paused','collected')),
 checkpoint jsonb not null, version integer not null default 0, mapping_version integer not null, mapping jsonb not null,
 lease_owner uuid, lease_until timestamptz, next_attempt_at timestamptz, failures integer not null default 0,
 last_error text, error_details jsonb, received bigint not null default 0, quarantined bigint not null default 0,
 started_by text not null, started_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz
);
create unique index bi_one_open_run on public.bi_runs(source_id) where status in ('running','paused');
create index bi_runs_latest on public.bi_runs(source_id,started_at desc);
create table public.bi_batches (
 id uuid primary key, run_id uuid not null references public.bi_runs(id), version integer not null, payload_hash text not null,
 result jsonb not null, received_at timestamptz not null default now(), unique(run_id,version)
);
create table public.bi_records (
 source_id uuid not null references public.bi_sources(id), entity text not null check(entity in ('contacts','deals','meetings','tasks','pipelines','stages','sources','campaigns','users','custom_fields','lost_reasons')),
 external_id text not null, data jsonb not null, payload_hash text not null, source_updated_at timestamptz, mapping_version integer not null,
 observed_at timestamptz not null default now(), last_run_id uuid not null references public.bi_runs(id),
 primary key(source_id,entity,external_id)
);
create table public.bi_record_versions (
 id bigint generated always as identity primary key, source_id uuid not null references public.bi_sources(id), entity text not null,
 external_id text not null, data jsonb not null, payload_hash text not null, source_updated_at timestamptz, mapping_version integer not null,
 observed_at timestamptz not null default now(), run_id uuid not null references public.bi_runs(id)
);
create index bi_record_timeline on public.bi_record_versions(source_id,entity,external_id,observed_at);
create table public.bi_ingestion_issues (
 source_id uuid not null references public.bi_sources(id), entity text not null, external_id text not null, code text not null,
 details jsonb not null default '{}', incoming_data jsonb not null, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 primary key(source_id,entity,external_id,code)
);

create function public.bi_register_source(p_source uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(424246001);
 update bi_sources set active=false,updated_at=now() where provider='rd_station' and id<>p_source and active;
 insert into bi_sources(id,provider) values(p_source,'rd_station') on conflict(id) do update set active=true,updated_at=now();
 return jsonb_build_object('source_id',p_source);
end $$;
create function public.bi_save_mapping(p_source uuid,p_expected integer,p_mapping jsonb,p_actor text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s bi_sources;
begin
 select * into s from bi_sources where id=p_source and active for update;
 if not found then raise exception 'BI_SOURCE_NOT_ACTIVE'; end if;
 if s.mapping_version<>p_expected then raise exception 'BI_MAPPING_CONFLICT'; end if;
 if jsonb_typeof(p_mapping->'funnels')<>'array' or (p_mapping->>'version')<>'1' then raise exception 'BI_MAPPING_INVALID'; end if;
 insert into bi_mapping_versions(source_id,version,mapping,actor) values(p_source,s.mapping_version+1,p_mapping,p_actor);
 update bi_sources set mapping=p_mapping,mapping_version=s.mapping_version+1,updated_at=now() where id=p_source;
 return jsonb_build_object('version',s.mapping_version+1);
end $$;
create function public.bi_start_run(p_source uuid,p_mode text,p_checkpoint jsonb,p_actor text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s bi_sources; r bi_runs;
begin
 select * into s from bi_sources where id=p_source and active for update;
 if not found then raise exception 'BI_SOURCE_NOT_ACTIVE'; end if;
 select * into r from bi_runs where source_id=p_source and status in ('running','paused');
 if found then
  if r.mode<>p_mode then raise exception 'BI_OTHER_RUN_OPEN'; end if;
  return to_jsonb(r);
 end if;
 if p_mode='commercial' and s.mapping_version=0 then raise exception 'BI_MAPPING_REQUIRED'; end if;
 insert into bi_runs(source_id,mode,checkpoint,mapping_version,mapping,started_by) values(p_source,p_mode,p_checkpoint,s.mapping_version,s.mapping,p_actor) returning * into r;
 return to_jsonb(r);
end $$;
create function public.bi_claim_run(p_run uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r bi_runs;
begin
 update bi_runs set lease_owner=p_lease,lease_until=now()+interval '120 seconds'
 where id=p_run and status='running' and (lease_until is null or lease_until<now()) and (next_attempt_at is null or next_attempt_at<=now())
 and exists(select 1 from bi_sources s where s.id=source_id and s.active) returning * into r;
 if not found then raise exception 'BI_RUN_BUSY_OR_PAUSED'; end if;
 return to_jsonb(r);
end $$;
create function public.bi_fail_run(p_run uuid,p_lease uuid,p_code text,p_details jsonb,p_retry integer) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r bi_runs;
begin
 if p_code !~ '^BI_[A-Z0-9_]{1,90}$' then raise exception 'BI_ERROR_INVALID'; end if;
 update bi_runs set lease_owner=null,lease_until=null,failures=failures+1,last_error=p_code,error_details=p_details,
 status=case when failures>=4 then 'paused' else 'running' end,next_attempt_at=now()+make_interval(secs=>greatest(2,least(86400,p_retry))),updated_at=now()
 where id=p_run and lease_owner=p_lease returning * into r;
 if not found then raise exception 'BI_LEASE_LOST'; end if;
 return to_jsonb(r);
end $$;
create function public.bi_resume_run(p_run uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r bi_runs;
begin
 update bi_runs set status='running',failures=0,next_attempt_at=null,updated_at=now() where id=p_run and status='paused' returning * into r;
 if not found then raise exception 'BI_RUN_NOT_PAUSED'; end if;
 return to_jsonb(r);
end $$;
create function public.bi_commit_batch(p_run uuid,p_lease uuid,p_version integer,p_batch uuid,p_hash text,p_entity text,p_records jsonb,p_checkpoint jsonb,p_done boolean)
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
   elsif stamp is not null and stamp=old.source_updated_at and old.mapping_version=r.mapping_version and old.payload_hash<>item->>'payload_hash' then reason:='SAME_VERSION_CONFLICT';
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

-- Nenhum dado comercial é exposto diretamente ao browser. RPCs só para o backend.
do $$ declare t text; f regprocedure;
begin
 foreach t in array array['bi_sources','bi_mapping_versions','bi_runs','bi_batches','bi_records','bi_record_versions','bi_ingestion_issues'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 grant usage,select on sequence public.bi_record_versions_id_seq to service_role;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('bi_register_source','bi_save_mapping','bi_start_run','bi_claim_run','bi_fail_run','bi_resume_run','bi_commit_batch') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
