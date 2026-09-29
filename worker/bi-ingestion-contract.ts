/** Recepção técnica do BI, independente de clientes/novas_vendas/parcelas. */
export const BI_ENTITIES = ['contacts','deals','meetings','tasks','pipelines','stages','sources','campaigns','users','custom_fields','lost_reasons'] as const;
export type BiEntity = typeof BI_ENTITIES[number];
export const BI_CATALOG_ENTITIES = ['pipelines','stages','sources','campaigns','users','custom_fields','lost_reasons'] as const;
export const BI_SEMANTICS = ['seller','meeting_seller','sdr','lead_owner','source','campaign','appointment_date','appointment_confirmed','attendance','modality','contract_id','sale_value'] as const;
export const BI_RECORD_FIELDS = new Set(['total_price','one_time_price','recurrence_price','expected_close_date','rating','created_by_id','completed_by_id','duration_minutes','subject','organization_id','id','name','created_at','updated_at','closed_at','status','amount','value','currency','pipeline_id','stage_id','source_id','campaign_id','owner_id','owner_ids','contact_id','contact_ids','deal_id','deal_ids','organizer_id','responsible_id','starts_at','ends_at','due_date','completed_at','type','lost_reason_id','custom_fields','slug','label','entity','options','display_rules','order','is_active','required']);
const NATIVE_FIELDS:Record<string,string[]>={deal:['owner_id','source_id','campaign_id','total_price','one_time_price','recurrence_price','closed_at','status','pipeline_id','stage_id','created_at'],contact:['created_at']};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function validateRecords(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('BI_BATCH_INVALID');
  const ids = new Set<string>();
  for (const record of value) {
    if (!object(record) || typeof record.external_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(record.external_id) || ids.has(record.external_id)) throw new Error('BI_RECORD_ID_INVALID');
    ids.add(record.external_id);
    if (!object(record.data) || record.data.id !== record.external_id || Object.keys(record.data).some(k => !BI_RECORD_FIELDS.has(k)) || JSON.stringify(record.data).length > 40000) throw new Error('BI_RECORD_INVALID');
    if (record.source_updated_at !== null && (typeof record.source_updated_at !== 'string' || !Number.isFinite(Date.parse(record.source_updated_at)))) throw new Error('BI_RECORD_DATE_INVALID');
    if (typeof record.payload_hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.payload_hash)) throw new Error('BI_RECORD_HASH_INVALID');
  }
  return value;
}
export function validateMapping(value: unknown) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.funnels) || value.funnels.length > 500) throw new Error('BI_MAPPING_INVALID');
  const pipelines = new Set<string>();
  for (const funnel of value.funnels) {
    if (!object(funnel) || typeof funnel.pipeline_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(funnel.pipeline_id) || pipelines.has(funnel.pipeline_id) || !object(funnel.fields)) throw new Error('BI_MAPPING_FUNNEL_INVALID');
    pipelines.add(funnel.pipeline_id);
    for (const [key, field] of Object.entries(funnel.fields)) {
      if (!(BI_SEMANTICS as readonly string[]).includes(key) || !object(field) || !['deal','contact'].includes(field.entity) || !['native','custom'].includes(field.kind) || typeof field.key !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(field.key)) throw new Error('BI_MAPPING_FIELD_INVALID');
      if(field.kind==='native'&&!NATIVE_FIELDS[field.entity].includes(field.key))throw new Error('BI_MAPPING_FIELD_INVALID');
      // Dono do negócio nunca vira vendedora ou SDR por reserva automática.
      if (['seller','meeting_seller','sdr'].includes(key) && field.kind !== 'custom') throw new Error('BI_ROLE_REQUIRES_EXPLICIT_CUSTOM_FIELD');
    }
  }
  return value;
}
