// Runs only against a dedicated NoteCalc-generated acceptance note.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const binary=process.env.NOTECALC_OBSIDIAN_BINARY??'/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const cli=(...args)=>execFileSync(binary,args,{encoding:'utf8',timeout:15000,maxBuffer:4_000_000}).trim();
const api=(command,args={})=>JSON.parse(cli('notecalc:'+command,'request='+JSON.stringify(args)));
const ok=(command,args={})=>{const r=api(command,args);assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
const host=code=>{const output=cli('eval','code='+code);assert.ok(output.startsWith('=> '),output);return JSON.parse(output.slice(3));};
const report={environment:{obsidian:cli('version'),platform:process.platform,node:process.version},generatedAt:new Date().toISOString(),checks:[]};
const check=(name,run)=>{const start=performance.now();try{const evidence=run();report.checks.push({name,status:'pass',milliseconds:Math.round(performance.now()-start),evidence});console.log('PASS '+name);}catch(error){report.checks.push({name,status:'fail',error:String(error)});fs.writeFileSync('acceptance/真实Obsidian自动验收.json',JSON.stringify(report,null,2));throw error;}};
const cap=ok('capabilities'),target={vaultId:cap.vaultId,path:'NoteCalc/自动验收-20261001.md',modelId:'training-delivery'};
const original='# NoteCalc 自动验收（仅测试模型）\n\n'+fs.readFileSync('examples/培训交付收益测算.md','utf8')+'\n<!-- 验收保留注释 -->\n```notecalc\n// @model isolated\na = 99\n```\n';
const path=JSON.stringify(target.path);
const existing=host(`JSON.stringify({exists:!!app.vault.getAbstractFileByPath(${path})})`);
if(existing.exists)throw Error('验收文件已存在；请指定新的测试文件，避免覆盖。');
cli('create','path='+target.path,'content='+original.replaceAll('\n','\\n'));
const source=()=>host(`(async()=>JSON.stringify(await app.vault.read(app.vault.getAbstractFileByPath(${path}))))()`);
const restore=()=>host(`(async()=>{await app.vault.process(app.vault.getAbstractFileByPath(${path}),()=>${JSON.stringify(original)});return JSON.stringify({restored:true});})()`);
const preview=(price,base=ok('inspect',{target}))=>ok('preview',{target,sessionId:base.sessionId,sourceRevision:base.sourceRevision,baseSnapshotId:base.snapshotId,changes:[{op:'set_input',name:'每单单价',literal:price}]});
const req=(p,id)=>({sessionId:p.sessionId,previewId:p.previewId,previewDigest:p.previewDigest,requestId:id});
// Host approvals below are test-only injections against this generated test note.
// The CLI API itself intentionally has no approval endpoint.
const approve=p=>host(`JSON.stringify((app.plugins.plugins.notecalc.runtime.approveFromUI(${JSON.stringify(p.previewId)},${JSON.stringify(p.previewDigest)}),{approvedByTestHost:true}))`);
try{
 check('基准八个结果及 Worker 快照',()=>{const b=ok('inspect',{target});for(const [name,value] of Object.entries({'毕业率':'0.5','每单学生提成':'1000','每单结余':'700','总单量':'80','总收入':'160000','学生提成合计':'80000','词元成本合计':'24000','组织方交付结余':'56000'}))assert.equal(b.values[name],value);return {snapshotId:b.snapshotId,values:b.values,stats:b.stats};});
 check('三个报价试算共用基准且不修改 Markdown',()=>{const b=ok('inspect',{target}),ps=['1500','2000','2500'].map(v=>preview(v,b));assert.deepEqual(ps.map(p=>p.snapshot.values['组织方交付结余']),['36000','56000','76000']);assert.ok(ps.every(p=>p.baseSnapshotId===b.snapshotId));assert.equal(source(),original);return {baseline:b.snapshotId,results:ps.map(p=>({price:p.snapshot.inputs['每单单价'],surplus:p.snapshot.values['组织方交付结余'],stats:p.snapshot.stats}))};});
 check('只读模式实际阻止 approved:true 提交',()=>{const p=preview('2500'),r=api('commit',{...req(p,'no-permission'),approved:true});assert.equal(r.ok,false);assert.equal(r.error.code,'PERMISSION');assert.equal(source(),original);return r.error;});
 check('修改源文档后旧候选被拒绝',()=>{const p=preview('2500');approve(p);host(`(async()=>{await app.vault.process(app.vault.getAbstractFileByPath(${path}),s=>s.replace('每单单价 = 2000','每单单价 = 2100'));return JSON.stringify({changed:true});})()`);const r=api('commit',req(p,'stale'));assert.equal(r.error.code,'STALE');assert.ok(source().includes('每单单价 = 2100'));restore();return r.error;});
 check('未打开文件定点提交、幂等回执与版本校验的撤回',()=>{const p=preview('2500');approve(p);const r=ok('commit',req(p,'closed-commit'));assert.equal(r.applied,true);assert.equal(r.saveStatus,'saved');assert.equal(source(),original.replace('每单单价 = 2000','每单单价 = 2500'));assert.deepEqual(ok('commit',req(p,'closed-commit')),r);const reverse=host(`(async()=>JSON.stringify(await app.plugins.plugins.notecalc.runtime.retractPreview(${JSON.stringify(r.receiptId)})))()`);approve(reverse);const rr=ok('commit',req(reverse,'closed-retract'));assert.equal(source(),original);return {receipt:r,reverseReceipt:rr,testHostApproval:true};});
 check('公式来源绑定试算快照',()=>{const p=preview('2500'),e=ok('explain',{target,name:'每单结余',scenarioId:p.scenarioId});assert.equal(e.value,'950');assert.equal(e.snapshotId,p.snapshot.snapshotId);assert.ok(e.dependencies.some(d=>d.name==='每单单价'&&d.value==='2500'));return e;});
 check('范围与步长在工具入口强制执行',()=>{const b=ok('inspect',{target});const r=api('preview',{target,sessionId:b.sessionId,sourceRevision:b.sourceRevision,baseSnapshotId:b.snapshotId,changes:[{op:'set_input',name:'每单单价',literal:'2550'}]});assert.equal(r.error.code,'STEP');assert.equal(source(),original);return r.error;});
 check('未完成公式、除零、循环均返回明确诊断',()=>{const results=[];for(const [expression,code] of [['每单单价 *','INCOMPLETE'],['1 / 0','DIV_ZERO'],['组织方交付结余','CYCLE']]){host(`(async()=>{await app.vault.process(app.vault.getAbstractFileByPath(${path}),()=>${JSON.stringify(original.replace('每单结余 := 每单单价 - 每单学生提成 - 每单词元成本','每单结余 := '+expression))});return JSON.stringify({changed:true});})()`);const b=ok('inspect',{target});assert.ok(b.diagnostics.some(d=>d.code===code),JSON.stringify(b.diagnostics));assert.equal(Object.keys(b.values).length,0);results.push({expression,status:b.status,diagnostics:b.diagnostics});}restore();return results;});
 check('当前编辑缓冲区优先于磁盘',()=>{cli('open','path='+target.path);const r=host(`(async()=>{const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${path});const editor=leaf.view.editor;editor.setValue(editor.getValue().replace('每单单价 = 2000','每单单价 = 2500'));const snapshot=await app.plugins.plugins.notecalc.runtime.inspect(${JSON.stringify(target)});return JSON.stringify({snapshot,disk:await app.vault.read(app.vault.getAbstractFileByPath(${path}))});})()`);assert.equal(r.snapshot.values['组织方交付结余'],'76000');assert.ok(r.snapshot.bufferIds.length>0);host(`JSON.stringify((app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${path}).view.editor.setValue(${JSON.stringify(original)}),{restored:true}))`);return {snapshot:r.snapshot.snapshotId,saveStatus:r.snapshot.saveStatus,diskStillBaseline:r.disk.includes('每单单价 = 2000'),bufferIds:r.snapshot.bufferIds};});
 check('不同 Vault 和越界路径被拒绝',()=>{const a=api('inspect',{target:{...target,vaultId:'wrong'}}),b=api('inspect',{target:{...target,path:'Private/secret.md'}});assert.equal(a.error.code,'VAULT');assert.equal(b.error.code,'SCOPE');return [a.error,b.error];});
}finally{
 cli('open','path=NoteCalc/培训交付收益测算.md');
 report.finishedAt=new Date().toISOString();report.pass=report.checks.filter(c=>c.status==='pass').length;report.fail=report.checks.filter(c=>c.status==='fail').length;
 fs.writeFileSync('acceptance/真实Obsidian自动验收.json',JSON.stringify(report,null,2));
}
