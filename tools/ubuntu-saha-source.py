#!/usr/bin/env python3
"""Native staff transport over the existing Saha PostgreSQL database.

Existing business rows are read and changed in their original tables. Private
sidecars retain native employee attribution without creating legacy Auth users.
No credentials, public listeners, or data copies are involved.
"""
from __future__ import annotations
import argparse,base64,copy,hashlib,importlib.util,json,os,re,subprocess,sys,uuid
from urllib.parse import urlsplit,unquote,quote,urlencode,parse_qs
from urllib.request import Request,urlopen
from pathlib import Path

HERE=Path(__file__).resolve().parent
source=HERE/'company_store.py'
if not source.exists():source=HERE/'ubuntu-company-bridge.py'
spec=importlib.util.spec_from_file_location('company_bridge',source)
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
SCHEMA=json.loads((HERE/'saha-source-schema.json').read_text(encoding='utf-8'))
DENIED=b.SAHA_DENIED|{'profiles','two_factor','security_policies','kvkk_consents'}
ALLOWED=set(SCHEMA)-DENIED
COMMON={'id','created_at','updated_at','created_by','updated_by'}

INSTALL_SQL="""
BEGIN;
CREATE SCHEMA IF NOT EXISTS voltguard_site;
REVOKE ALL ON SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS voltguard_site.saha_native_rows(
 site text NOT NULL,collection text NOT NULL,record_id text NOT NULL,fields jsonb NOT NULL DEFAULT '{}'::jsonb,
 source_hash text NOT NULL,revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by text,updated_by text,PRIMARY KEY(site,collection,record_id));
CREATE TABLE IF NOT EXISTS voltguard_site.saha_records(
 site text NOT NULL,id text NOT NULL,collection text NOT NULL,record_id text NOT NULL,payload jsonb NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by text,updated_by text,PRIMARY KEY(site,id),UNIQUE(site,collection,record_id));
CREATE TABLE IF NOT EXISTS voltguard_site.preferences(site text NOT NULL,staff_id text NOT NULL,key text NOT NULL,value text NOT NULL,PRIMARY KEY(site,staff_id,key));
CREATE TABLE IF NOT EXISTS voltguard_site.commits(site text NOT NULL,request_id uuid NOT NULL,staff_id text NOT NULL,input_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(site,request_id));
CREATE TABLE IF NOT EXISTS voltguard_site.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,site text NOT NULL,request_id uuid NOT NULL,staff_id text NOT NULL,event text NOT NULL,target text NOT NULL,occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON ALL TABLES IN SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
ALTER TABLE voltguard_site.saha_native_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.saha_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.audit ENABLE ROW LEVEL SECURITY;
COMMIT;
"""

def key(collection,identifier):return hashlib.sha256((collection+':'+identifier).encode()).hexdigest()

def storage_reference(value):
 if not isinstance(value,str):return None
 try:
  path=urlsplit(value).path
  match=re.fullmatch(r'/storage/v1/object/(?:public|authenticated|sign)/([A-Za-z0-9_.-]{1,80})/(.{1,1000})',path)
  if not match:return None
  bucket,name=match.groups()
  for _ in range(3):
   decoded=unquote(name)
   if decoded==name:break
   name=decoded
  if any(p in {'','..','.'} for p in name.split('/')) or any(ord(c)<32 for c in name) or '\\' in name:return None
  return bucket,name
 except ValueError:return None

def protected_urls(value):
 if isinstance(value,dict):return {k:protected_urls(v) for k,v in value.items()}
 if isinstance(value,list):return [protected_urls(v) for v in value]
 ref=storage_reference(value)
 return '/api/saha-asset.php?'+urlencode({'bucket':ref[0],'path':ref[1]}) if ref else value

def has_reference(value,bucket,name):
 if isinstance(value,dict):return any(has_reference(v,bucket,name) for v in value.values())
 if isinstance(value,list):return any(has_reference(v,bucket,name) for v in value)
 return storage_reference(value)==(bucket,name)

def has_legacy_reference(value):
 if isinstance(value,dict):return any(has_legacy_reference(v) for v in value.values())
 if isinstance(value,list):return any(has_legacy_reference(v) for v in value)
 return storage_reference(value) is not None

def has_protected_reference(value,bucket,name):
 if isinstance(value,dict):return any(has_protected_reference(v,bucket,name) for v in value.values())
 if isinstance(value,list):return any(has_protected_reference(v,bucket,name) for v in value)
 if not isinstance(value,str):return False
 try:
  parsed=urlsplit(value);query=parse_qs(parsed.query)
  return parsed.path=='/api/saha-asset.php' and query.get('bucket')==[bucket] and query.get('path')==[name]
 except ValueError:return False

def file_reference_allowed(visible,origins,bucket,name):
 if bucket not in {'photos','customer-docs','chat-attachments'}:return False
 for k,row in visible.items():
  origin=origins[k]
  if not origin['native']:continue
  raw=origin['raw']
  if bucket=='chat-attachments' and (row['collection']!='messages' or not name.startswith(str(raw.get('sender_id'))+'/')):continue
  if bucket=='customer-docs' and row['collection'] not in {'customer_documents','quotes','quote_revisions'}:continue
  if has_reference(raw,bucket,name) and has_protected_reference(row['payload'],bucket,name):return True
 return False

class Repository:
 def __init__(self,db):self.db=db;self.columns={};self.kinds={};self.pks={};self.fks=[];self.source={};self.rows={};self.site=None
 def metadata(self):
  names=','.join(b.sql_text(t) for t in sorted(ALLOWED))
  cols=self.db.json("SELECT coalesce(json_agg(json_build_object('table',table_name,'name',column_name,'type',udt_name,'nullable',is_nullable='YES','generated',is_generated!='NEVER')), '[]') FROM information_schema.columns WHERE table_schema='public' AND table_name IN ("+names+");")
  for c in cols:self.columns.setdefault(c['table'],{})[c['name']]=c
  kinds=self.db.json("SELECT coalesce(json_agg(json_build_object('table',c.relname,'kind',c.relkind)), '[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ("+names+") AND c.relkind IN ('r','p','v','m');")
  self.kinds={r['table']:r['kind'] for r in kinds}
  pks=self.db.json("SELECT coalesce(json_agg(json_build_object('table',t.relname,'columns',(SELECT json_agg(a.attname ORDER BY u.ordinality) FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum))), '[]') FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.contype='p';")
  self.pks={r['table']:r['columns'] for r in pks}
  self.fks=self.db.json("SELECT coalesce(json_agg(json_build_object('table',t.relname,'column',a.attname,'targetSchema',nt.nspname,'target',tt.relname,'targetColumn',at.attname)), '[]') FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1] JOIN pg_class tt ON tt.oid=c.confrelid JOIN pg_namespace nt ON nt.oid=tt.relnamespace JOIN pg_attribute at ON at.attrelid=tt.oid AND at.attnum=c.confkey[1] WHERE n.nspname='public' AND c.contype='f' AND array_length(c.conkey,1)=1;")
 def target(self,c):return 'public.'+b.sql_ident(c)
 def identifier(self,c,row):
  if row.get('id') is not None:return str(row['id'])
  columns=self.pks.get(c)
  if not columns:raise b.BridgeError('bridge_saha_primary_key',503)
  return str(uuid.uuid5(b.ACTOR_NAMESPACE,'saha:'+c+':'+b.encode({n:row[n] for n in columns})))
 def read(self,lock=False):
  self.metadata();self.rows={};self.source={}
  sides=self.db.json("SELECT coalesce(json_agg(to_jsonb(t)), '[]') FROM voltguard_site.saha_native_rows t WHERE site="+b.sql_text(self.site)+";")
  sides={(r['collection'],r['record_id']):r for r in sides}
  for c,cols in self.columns.items():
   selected=set(cols)&(set(SCHEMA[c])|COMMON);selected|=set(self.pks.get(c,[]))
   if not selected:continue
   suffix=' FOR UPDATE' if lock and self.kinds[c] in {'r','p'} else ''
   rows=self.db.json("SELECT coalesce(json_agg(to_jsonb(t)), '[]') FROM (SELECT "+','.join(b.sql_ident(n) for n in sorted(selected))+" FROM "+self.target(c)+suffix+") t;")
   for raw in rows:
    rid=self.identifier(c,raw);side=sides.get((c,rid));bindings=side['fields'] if side else {};payload={n:v for n,v in raw.items() if n in set(SCHEMA[c])|COMMON};payload['id']=rid
    for field,binding in bindings.items():
     if isinstance(binding,dict) and binding.get('anchor')==raw.get(field):payload[field]=binding.get('value')
    revision=side['revision'] if side and side['source_hash']==b.token(raw) else int(b.token({'raw':raw,'bindings':bindings})[:12],16)+1
    row={'id':key(c,rid),'collection':c,'record_id':rid,'payload':protected_urls(payload),'revision':revision,'created_at':raw.get('created_at') or (side or {}).get('created_at'),'updated_at':raw.get('updated_at') or (side or {}).get('updated_at'),'created_by':(side or {}).get('created_by'),'updated_by':(side or {}).get('updated_by')}
    self.rows[row['id']]=row;self.source[row['id']]={'raw':raw,'side':side,'native':True}
  private=self.db.json("SELECT coalesce(json_agg(to_jsonb(t)-'site'), '[]') FROM voltguard_site.saha_records t WHERE site="+b.sql_text(self.site)+(' FOR UPDATE' if False else '')+";")
  for row in private:
   if row['collection'] in DENIED:continue
   if row['id'] in self.rows:raise b.BridgeError('bridge_saha_duplicate_source',503)
   self.rows[row['id']]=row;self.source[row['id']]={'raw':row,'side':None,'native':False}
 def prefs(self,actor):
  rows=self.db.json("SELECT coalesce(json_agg(json_build_object('key',key,'value',value)), '[]') FROM voltguard_site.preferences WHERE site="+b.sql_text(self.site)+" AND staff_id="+b.sql_text(actor['id'])+";")
  return {r['key']:r['value'] for r in rows}
 def hash(self,k):return b.token(self.source[k])
 def snapshot(self,request):
  actor=b.validate_actor(request.get('actor'));self.site=b.validate_site(request.get('site'));self.db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');self.read()
  visible=b.saha_snapshot_records(actor,self.rows);prefs=self.prefs(actor);self.db.execute('COMMIT;')
  return {'state':{'version':1,'tables':{'saha_records':visible},'storage':{actor['id']:prefs},'sequence':0,'audit':[]},'snapshot':{'rows':{'saha_records':{k:self.hash(k) for k in visible}},'prefs':{k:b.token(v) for k,v in prefs.items()}}}
 def where(self,c,raw,alias=''):
  prefix=alias+'.' if alias else '';cols=self.pks.get(c) or (['id'] if 'id' in raw else [])
  if not cols:raise b.BridgeError('bridge_saha_primary_key',503)
  return ' AND '.join(prefix+b.sql_ident(n)+(' IS NULL' if raw[n] is None else '::text='+b.sql_text(str(raw[n]))) for n in cols)
 def private_write(self,desired,old,actor):
  if desired is None:
   self.db.execute("DELETE FROM voltguard_site.saha_records WHERE site="+b.sql_text(self.site)+" AND id="+b.sql_text(old['id'])+";");return None
  row=dict(desired);row['created_by']=(old or {}).get('created_by') or actor['id'];row['updated_by']=actor['id']
  fields=['site','id','collection','record_id','payload','revision','created_by','updated_by'];values=[b.sql_text(self.site),b.sql_text(row['id']),b.sql_text(row['collection']),b.sql_text(row['record_id']),b.sql_json(row['payload']),str(row['revision']),b.sql_text(row['created_by']),b.sql_text(row['updated_by'])]
  result=self.db.json("WITH changed AS (INSERT INTO voltguard_site.saha_records("+','.join(fields)+") VALUES("+','.join(values)+") ON CONFLICT(site,id) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp() RETURNING *) SELECT to_jsonb(changed)-'site' FROM changed;")
  return result
 def write(self,desired,old,actor):
  c=(desired or old)['collection'];rid=(desired or old)['record_id'];origin=self.source.get(key(c,rid));raw=(origin or {}).get('raw',{});side=(origin or {}).get('side') or {};payload=(desired or old)['payload']
  if c not in ALLOWED and c not in {'_files','_cache'}:raise b.BridgeError('bridge_saha_collection',403)
  if desired:
   old_payload=(old or {}).get('payload',{})
   for field,value in desired['payload'].items():
    if value!=old_payload.get(field) and has_legacy_reference(value):raise b.BridgeError('bridge_saha_legacy_reference',403)
  if origin and not origin['native'] or c not in self.columns:return self.private_write(desired,old,actor)
  if not old and 'id' in self.columns[c] and self.columns[c]['id']['type'] in {'int2','int4','int8'} and not rid.isdigit():return self.private_write(desired,old,actor)
  if self.kinds[c] not in {'r','p'}:raise b.BridgeError('bridge_saha_readonly',403)
  if desired is None:
   for fk in self.fks:
    if fk['targetSchema']=='public' and fk['target']==c and raw.get(fk['targetColumn']) is not None:
     exists=self.db.json("SELECT json_build_object('exists',EXISTS(SELECT 1 FROM public."+b.sql_ident(fk['table'])+" WHERE "+b.sql_ident(fk['column'])+'::text='+b.sql_text(str(raw[fk['targetColumn']]))+"));")
     if exists['exists']:raise b.BridgeError('bridge_saha_relation_in_use',409)
   self.db.execute('DELETE FROM '+self.target(c)+' WHERE '+self.where(c,raw)+';');self.db.execute("DELETE FROM voltguard_site.saha_native_rows WHERE site="+b.sql_text(self.site)+" AND collection="+b.sql_text(c)+" AND record_id="+b.sql_text(rid)+";");return None
  values={};bindings=copy.deepcopy(side.get('fields',{}));old_payload=(old or {}).get('payload',{})
  for field,value in desired['payload'].items():
   if field not in set(SCHEMA[c])|COMMON:raise b.BridgeError('bridge_saha_field')
   if old and value==old_payload.get(field):continue
   if field not in self.columns[c]:bindings[field]={'value':value,'anchor':None};continue
   column=self.columns[c][field]
   if column['generated'] or old and field in self.pks.get(c,[]):continue
   fk=next((f for f in self.fks if f['table']==c and f['column']==field and (f['targetSchema']=='auth' and f['target']=='users' or f['targetSchema']=='public' and f['target']=='profiles')),None)
   if fk and value is not None:
    exists=self.db.json('SELECT json_build_object(\'exists\',EXISTS(SELECT 1 FROM '+b.sql_ident(fk['targetSchema'])+'.'+b.sql_ident(fk['target'])+' WHERE '+b.sql_ident(fk['targetColumn'])+'::text='+b.sql_text(str(value))+'));')['exists']
    if not exists:
     if not old and not column['nullable']:return self.private_write(desired,old,actor)
     values[field]=raw.get(field) if old else None;bindings[field]={'value':value,'anchor':values[field]};continue
   values[field]=value;bindings.pop(field,None)
  if not old and 'id' not in self.columns[c]:return self.private_write(desired,old,actor)
  if old and not values:actual=raw
  elif old:
   assignments=','.join(b.sql_ident(n)+'=v.'+b.sql_ident(n) for n in values)
   rows=self.db.json('WITH changed AS (UPDATE '+self.target(c)+' t SET '+assignments+' FROM jsonb_populate_record(NULL::'+self.target(c)+','+b.sql_json(values)+') v WHERE '+self.where(c,raw,'t')+' RETURNING t.*) SELECT coalesce(json_agg(to_jsonb(changed)),\'[]\') FROM changed;')
   if len(rows)!=1:raise b.BridgeError('bridge_conflict',409)
   actual=rows[0]
  else:
   names=','.join(b.sql_ident(n) for n in values);projection=','.join('v.'+b.sql_ident(n) for n in values)
   rows=self.db.json('WITH changed AS (INSERT INTO '+self.target(c)+'('+names+') SELECT '+projection+' FROM jsonb_populate_record(NULL::'+self.target(c)+','+b.sql_json(values)+') v RETURNING *) SELECT json_agg(to_jsonb(changed)) FROM changed;');actual=rows[0]
  # Keep only reviewed columns, identical to snapshot hashing/projection.
  selected=set(self.columns[c])&(set(SCHEMA[c])|COMMON);selected|=set(self.pks.get(c,[]));actual={n:v for n,v in actual.items() if n in selected}
  for n,binding in bindings.items():binding['anchor']=actual.get(n)
  created_by=side.get('created_by') or actor['id']
  self.db.execute("INSERT INTO voltguard_site.saha_native_rows(site,collection,record_id,fields,source_hash,revision,created_by,updated_by) VALUES("+','.join([b.sql_text(self.site),b.sql_text(c),b.sql_text(rid),b.sql_json(bindings),b.sql_text(b.token(actual)),str(desired['revision']),b.sql_text(created_by),b.sql_text(actor['id'])])+") ON CONFLICT(site,collection,record_id) DO UPDATE SET fields=EXCLUDED.fields,source_hash=EXCLUDED.source_hash,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();")
  result=dict(desired);result['payload']={n:v for n,v in actual.items() if n in set(SCHEMA[c])|COMMON};result['payload']['id']=rid
  for n,binding in bindings.items():result['payload'][n]=binding['value']
  result['payload']=protected_urls(result['payload']);result['created_by']=created_by;result['updated_by']=actor['id'];result['created_at']=actual.get('created_at') or desired.get('created_at');result['updated_at']=actual.get('updated_at') or desired.get('updated_at');return result
 def file(self,request):
  actor=b.validate_actor(request.get('actor'));self.site=b.validate_site(request.get('site'));bucket=request.get('bucket');name=request.get('path')
  if not isinstance(bucket,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',bucket) or not isinstance(name,str) or not name or len(name)>1000 or any(x in {'','..','.'} for x in name.split('/')) or any(ord(c)<32 for c in name) or '\\' in name:raise b.BridgeError('bridge_saha_file_path')
  self.db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');self.read();visible=b.saha_snapshot_records(actor,self.rows)
  # Compare against original source URLs before exposing any legacy object.
  permitted=file_reference_allowed(visible,self.source,bucket,name)
  self.db.execute('COMMIT;')
  if not permitted:raise b.BridgeError('bridge_saha_file_scope',404)
  result=subprocess.run(['docker','inspect','sb-sahatakip-storage'],capture_output=True,text=True,timeout=10)
  if result.returncode:raise b.BridgeError('bridge_saha_file_service',503)
  container=json.loads(result.stdout)[0];env=dict(x.split('=',1) for x in container['Config']['Env'] if '=' in x)
  service_key=env.get('SERVICE_KEY') or env.get('SERVICE_ROLE_KEY') or env.get('SUPABASE_SERVICE_KEY')
  addresses=[n.get('IPAddress') for n in container['NetworkSettings']['Networks'].values() if n.get('IPAddress')]
  if not service_key or not addresses:raise b.BridgeError('bridge_saha_file_service',503)
  address=addresses[0]
  if not re.fullmatch(r'[0-9.]+',address):raise b.BridgeError('bridge_saha_file_service',503)
  url='http://'+address+':5000/object/authenticated/'+quote(bucket,safe='')+'/'+quote(name,safe='/')
  with urlopen(Request(url,headers={'Authorization':'Bearer '+service_key,'apikey':service_key}),timeout=20) as response:
   data=response.read(8*1024*1024+1);mime=response.headers.get_content_type()
  if len(data)>8*1024*1024:raise b.BridgeError('bridge_saha_file_capacity',413)
  safe={'application/pdf','image/png','image/jpeg','image/webp','image/gif','image/avif','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','audio/webm','audio/ogg','audio/mpeg','video/webm','video/mp4'}
  return {'base64':base64.b64encode(data).decode('ascii'),'contentType':mime if mime in safe else 'application/octet-stream','size':len(data)}
 def commit(self,request):
  actor=b.validate_actor(request.get('actor'));self.site=b.validate_site(request.get('site'));rid=request.get('requestId');
  if not isinstance(rid,str) or not b.UUID.fullmatch(rid):raise b.BridgeError('bridge_request_id')
  changes,prefs,audit=b.validate_commit(request,actor)
  if any(c['table']!='saha_records' for c in changes):raise b.BridgeError('bridge_table',403)
  self.db.execute('BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT pg_advisory_xact_lock(867138121742);');fingerprint=b.token(request)
  saved=self.db.json("SELECT coalesce(json_agg(to_jsonb(c)), '[]') FROM voltguard_site.commits c WHERE site="+b.sql_text(self.site)+" AND request_id="+b.sql_text(rid)+"::uuid;")
  if saved:
   if saved[0]['staff_id']!=actor['id'] or saved[0]['input_hash']!=fingerprint:raise b.BridgeError('bridge_request_reused',409)
   self.db.execute('COMMIT;');return saved[0]['response']
  self.read(lock=True);current_prefs=self.prefs(actor);graph=copy.deepcopy(self.rows)
  for change in changes:
   k=change['id'];old=self.rows.get(k)
   if (self.hash(k) if old else None)!=change['before']:raise b.BridgeError('bridge_conflict',409)
   b.saha_validate_change(actor,old,change['row'],graph)
   if change['row'] is None:graph.pop(k,None)
   else:graph[k]=change['row']
  for p in prefs:
   if (b.token(current_prefs[p['key']]) if p['key'] in current_prefs else None)!=p['before']:raise b.BridgeError('bridge_conflict',409)
  rows={}
  for change in changes:rows[change['id']]=self.write(change['row'],self.rows.get(change['id']),actor)
  for p in prefs:
   if p['value'] is None:self.db.execute("DELETE FROM voltguard_site.preferences WHERE site="+b.sql_text(self.site)+" AND staff_id="+b.sql_text(actor['id'])+" AND key="+b.sql_text(p['key'])+";")
   else:self.db.execute("INSERT INTO voltguard_site.preferences(site,staff_id,key,value) VALUES("+','.join(b.sql_text(x) for x in [self.site,actor['id'],p['key'],p['value']])+") ON CONFLICT(site,staff_id,key) DO UPDATE SET value=EXCLUDED.value;")
  for event in audit:self.db.execute("INSERT INTO voltguard_site.audit(site,request_id,staff_id,event,target,occurred_at) VALUES("+','.join([b.sql_text(self.site),b.sql_text(rid)+'::uuid',b.sql_text(actor['id']),b.sql_text(event['event']),b.sql_text(event['target']),b.sql_text(event['at'])+'::timestamptz'])+");")
  response={'rows':{'saha_records':rows},'aliases':{},'sequence':0,'requestId':rid}
  self.db.execute("INSERT INTO voltguard_site.commits(site,request_id,staff_id,input_hash,response) VALUES("+','.join([b.sql_text(self.site),b.sql_text(rid)+'::uuid',b.sql_text(actor['id']),b.sql_text(fingerprint),b.sql_json(response)])+"); COMMIT;")
  return response

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--config',default='/home/emrullah/voltguard-site-bridge/saha-config.json');parser.add_argument('--install',action='store_true');args=parser.parse_args();db=None
 try:
  raw=sys.stdin.buffer.read(b.MAX_INPUT+1)
  if len(raw)>b.MAX_INPUT:raise b.BridgeError('bridge_input_capacity',413)
  request=json.loads(raw)
  if not isinstance(request,dict):raise b.BridgeError('bridge_input')
  db=b.Psql(b.read_config(args.config));repo=Repository(db)
  if args.install:
   if request!={'op':'install'}:raise b.BridgeError('bridge_operation')
   db.execute(INSTALL_SQL);result={'installed':True}
  elif request.get('op')=='snapshot':result=repo.snapshot(request)
  elif request.get('op')=='commit':result=repo.commit(request)
  elif request.get('op')=='file':result=repo.file(request)
  elif request.get('op')=='health':b.validate_actor(request.get('actor'));b.validate_site(request.get('site'));result={'healthy':db.json("SELECT json_build_object('healthy',true);")['healthy']}
  else:raise b.BridgeError('bridge_operation',403)
  output=b.encode({'protocol':b.PROTOCOL,'ok':True,**result})
  if len(output.encode())>b.MAX_OUTPUT:raise b.BridgeError('bridge_capacity',503)
  print(output)
 except b.BridgeError as e:print(b.encode({'protocol':b.PROTOCOL,'ok':False,'code':e.code,'error':e.code,'status':e.status}))
 except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):print(b.encode({'protocol':b.PROTOCOL,'ok':False,'code':'bridge_saha_source_unavailable','status':503}))
 finally:
  if db:db.close()

if __name__=='__main__':main()
