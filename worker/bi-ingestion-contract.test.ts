import {describe,it,expect} from 'vitest';
import {validateMapping,validateRecords} from './bi-ingestion-contract';
describe('contrato de recepção BI',()=>{
 it('exige seleção explícita para SDR e vendedora, sem substituir por owner',()=>{
  const mapping={version:1,funnels:[{pipeline_id:'p1',fields:{seller:{entity:'deal',kind:'native',key:'owner_id'}}}]};expect(()=>validateMapping(mapping)).toThrow('BI_ROLE_REQUIRES_EXPLICIT_CUSTOM_FIELD');
  mapping.funnels[0].fields.seller={entity:'deal',kind:'custom',key:'nome_vendedora'};expect(validateMapping(mapping)).toEqual(mapping);
 });
 it('não aceita funis duplicados ou campo nativo inexistente',()=>{
  expect(()=>validateMapping({version:1,funnels:[{pipeline_id:'p1',fields:{}},{pipeline_id:'p1',fields:{}}]})).toThrow('BI_MAPPING_FUNNEL_INVALID');
  expect(()=>validateMapping({version:1,funnels:[{pipeline_id:'p1',fields:{source:{entity:'deal',kind:'native',key:'invented'}}}]})).toThrow('BI_MAPPING_FIELD_INVALID');
 });
 it('rejeita ID duplicado, payload com dados fora do contrato e hash inválido',()=>{
  const r={external_id:'a',data:{id:'a'},source_updated_at:null,payload_hash:'a'.repeat(64)};expect(validateRecords([r])).toEqual([r]);expect(()=>validateRecords([r,r])).toThrow('BI_RECORD_ID_INVALID');
  expect(()=>validateRecords([{...r,data:{id:'a',email:'private'}}])).toThrow('BI_RECORD_INVALID');expect(()=>validateRecords([{...r,payload_hash:'wrong'}])).toThrow('BI_RECORD_HASH_INVALID');
 });
});
