import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';

test('brief history migration preserves existing projects, paginates and records only committed writes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'studio-brief-history-')),db=new SqliteDatabase(':memory:');
  const base='https://history.studio.test',env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(directory),APP_URL:base,ENCRYPTION_KEY:secret(),ALLOW_REGISTRATION:'true'};
  let cookie='';
  const request=(path:string,method='GET',body?:unknown)=>app.request(base+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  try {
    const files=(await readdir(new URL('../migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort();
    for(const file of files.filter(file=>file<'0017'))await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
    const registered=await request('/api/auth/register','POST',{email:'history@studio.test',password:secret()});assert.equal(registered.status,201);
    cookie=registered.headers.get('set-cookie')!.split(';')[0];const {user}=await registered.json() as any;
    const {project}=await (await request('/api/projects','POST',{name:'Existing project',kind:'web'})).json() as any;
    const path=`/api/projects/${project.id}/brief`;
    await request(path,'PUT',{expectedRevision:0,request:'An existing request'});
    const updated=await request(path,'PUT',{expectedRevision:1,request:'A revised existing request'});assert.equal(updated.status,200);
    const {brief:before}=await updated.json() as any;
    await db.prepare('INSERT INTO agent_sessions(id,project_id,user_id,provider,draft_document,base_revision,base_brief_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('existing-session',project.id,user.id,'codex',JSON.stringify(project.document),project.revision,2,before.updatedAt,before.updatedAt).run();
    await db.exec(await readFile(new URL('../migrations/0017-conversational-workspace.sql',import.meta.url),'utf8'));
    assert.deepEqual(await (await request(path)).json(),{brief:before});
    assert.deepEqual(await (await request(path+'/history')).json(),{history:[before],nextAfter:null});
    assert.equal((await db.prepare('SELECT purpose FROM agent_sessions WHERE id=?').bind('existing-session').first<{purpose:string}>())!.purpose,'design');
    // Enough committed revisions to exercise the continuation cursor, without model calls.
    for(let revision=2;revision<54;revision++)assert.equal((await request(path,'PUT',{expectedRevision:revision,request:`Request revision ${revision+1}`})).status,200);
    const first=await (await request(path+'/history')).json() as any;
    assert.equal(first.history.length,50);assert.equal(first.history[0].revision,2);assert.equal(first.nextAfter,51);
    const second=await (await request(path+'/history?after='+first.nextAfter)).json() as any;
    assert.deepEqual(second.history.map((brief:any)=>brief.revision),[52,53,54]);assert.equal(second.nextAfter,null);
    assert.deepEqual(first.history[0],before);
    assert.equal((await request(path,'PUT',{expectedRevision:53,request:'Stale write'})).status,409);
    assert.deepEqual(await (await request(path+'/history?after=54')).json(),{history:[],nextAfter:null});
    assert.equal((await request(path+'/history?after=-1')).status,400);
    assert.equal((await request(`/api/projects/${project.id}`,'DELETE')).status,200);
    assert.equal(await db.prepare('SELECT revision FROM brief_history WHERE project_id=?').bind(project.id).first(),null);
  } finally { db.close(); await rm(directory,{recursive:true,force:true}); }
});
