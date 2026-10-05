import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {calculateMarkdown} from '../dist/notecalc-core.mjs';
const binary = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const cli = (...args) => {
  const raw = execFileSync(binary, args, {encoding:'utf8', timeout:15000, maxBuffer:5e6}).trim();
  if (!raw) throw new Error('运行时未返回响应；不要假设写操作没有执行');
  return raw;
};
const api = (command, request={}) => JSON.parse(cli('notecalc:'+command, 'request='+JSON.stringify(request)));
const ok = (command, request={}) => {
  const response=api(command,request); assert.equal(response.ok,true,JSON.stringify(response)); return response.result;
};
const host = code => JSON.parse(cli('eval','code='+code).slice(3));
const source='<!-- notecalc id=hardening -->\n- constructor：`2`\n- __proto__：`3`\n- 总：`constructor + __proto__`\n<!-- /notecalc -->\n';
const path='NoteCalc/健壮性验收-20261001-031.md';
const cap=ok('capabilities'); assert.equal(cap.engine.engineVersion,'0.3.1');
assert.deepEqual(cap.permissions.inputGrants,[]);
host(`(async()=>{const old=app.vault.getAbstractFileByPath(${JSON.stringify(path)});if(old){if(await app.vault.read(old)!==${JSON.stringify(source)})throw Error('已有验收文件不同，停止');}else await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});return JSON.stringify({generatedAcceptanceNote:true});})()`);
const target={vaultId:cap.vaultId,path,modelId:'hardening'};
const base=ok('inspect',{target}); assert.equal(base.status,'valid'); assert.equal(base.values.总,'5');
const p=ok('preview',{target,sessionId:base.sessionId,sourceRevision:base.sourceRevision,baseSnapshotId:base.snapshotId,
  changes:[{op:'set_input',name:'__proto__',literal:'5'}]});
assert.equal(p.snapshot.values.总,'7');
const denied=api('commit',{sessionId:p.sessionId,previewId:p.previewId,previewDigest:p.previewDigest,requestId:'hardening-denied-031',approved:true});
assert.equal(denied.error.code,'PERMISSION');
const unchanged=ok('inspect',{target}); assert.equal(unchanged.values.总,'5');
ok('discard',{previewId:p.previewId});
const sample=ok('inspect',{target:{...target,path:'NoteCalc/Markdown交付收益测算.md',modelId:'delivery-note'}});
const ui=host('JSON.stringify({file:app.workspace.getActiveFile()?.path,source:app.workspace.getLeavesOfType("markdown").find(l=>l.view.file?.path==="NoteCalc/Markdown交付收益测算.md")?.view.editor?.getValue(),annotations:[...document.querySelectorAll(".cm-line .notecalc-inline")].map(e=>e.textContent)})');
// The user may edit their sample at any time. Validate its current buffer, never restore an old fixture.
if(typeof ui.source!=='string')throw Error('当前样例缓冲区不可读取');
const expected=calculateMarkdown(ui.source)[0].result;
assert.equal(expected.status,'valid');assert.deepEqual(sample.values,{...expected.values});
assert.ok(ui.annotations.some(text=>text.includes(sample.displayValues.组织方交付结余)));
const report={version:'0.3.1',generatedAt:new Date().toISOString(),sessionId:cap.sessionId,scope:cap.scope,
  checks:[{name:'已安装修复版',engine:cap.engine},{name:'真实 Obsidian Worker 特殊变量名',result:base.values},
    {name:'实际候选传输后计算',result:p.snapshot.values},{name:'Agent approved 无法越权',error:denied.error},
    {name:'源值保持不变',result:unchanged.values},{name:'既有 Markdown 收益示例与编辑行旁结果',result:sample.displayValues,ui}],
  permissions:cap.permissions};
fs.writeFileSync('acceptance/审查-实际Obsidian验收.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({version:report.version,checks:report.checks.length,passed:true}));
