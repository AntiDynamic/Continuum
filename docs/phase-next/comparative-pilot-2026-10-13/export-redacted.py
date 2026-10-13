"""Publish sanitized copies; never alter original protocol traces or SQLite evidence."""
import json,sqlite3,os,hashlib
root=os.path.dirname(__file__);base=os.path.join(root,'live');emails=set()
for arm in 'ABCD':
 for r in map(json.loads,open(f'{base}/{arm}/{arm}-trace.jsonl')):
  result=(r.get('parsed') or {}).get('result')
  if isinstance(result,dict) and isinstance(result.get('account'),dict) and result['account'].get('email'):emails.add(result['account']['email'])
manifest={}
for arm in 'ABCD':
 source=f'{base}/{arm}/{arm}-trace.jsonl';target=f'{base}/{arm}/{arm}-redacted-trace.jsonl';text=open(source).read()
 for email in emails:text=text.replace(email,'[REDACTED_EMAIL]')
 open(target,'w').write(text);manifest[os.path.relpath(target,root)]=hashlib.sha256(open(target,'rb').read()).hexdigest()
 if arm!='A':
  source=f'{base}/{arm}/memory.db';target=f'{base}/{arm}/redacted-memory.db'
  original=sqlite3.connect(f'file:{source}?mode=ro',uri=True);copy=sqlite3.connect(target);original.backup(copy);original.close()
  triggers=list(copy.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='codex_raw_events'"))
  for name,sql in triggers:copy.execute('DROP TRIGGER '+name)
  for email in emails:copy.execute('UPDATE codex_raw_events SET raw_json=replace(raw_json,?,?) WHERE instr(raw_json,?)>0',(email,'[REDACTED_EMAIL]',email))
  for name,sql in triggers:copy.execute(sql)
  copy.commit();copy.execute('VACUUM');copy.close()
  if any(email.encode() in open(target,'rb').read() for email in emails):raise RuntimeError('Account metadata remains in public database')
  manifest[os.path.relpath(target,root)]=hashlib.sha256(open(target,'rb').read()).hexdigest()
json.dump({'policy':'Only account email redacted; original local traces/databases untouched and excluded from Git. Provider usage, task evidence, protocol identities and validation unchanged.','files':manifest},open(root+'/redacted-export.json','w'),indent=2)
