// macOS host acceptance; setup opens a generated test note; restore closes only that test tab.
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const binary='/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const cli=(...args)=>{const raw=execFileSync(binary,args,{encoding:'utf8',timeout:15000,maxBuffer:5e6}).trim();if(!raw)throw Error('无响应');return raw;};
const api=(cmd,body={})=>{const r=JSON.parse(cli('notecalc:'+cmd,'request='+JSON.stringify(body)));assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
const host=code=>JSON.parse(cli('eval','code='+code).slice(3));
const path='NoteCalc/局部错误与排版验收-20261004-032.md';
const reportFile=root+'/acceptance/0.3.2-实际Obsidian验收.json';
const source=fs.readFileSync(root+'/examples/局部错误与排版验收.md','utf8');
const mode=process.argv[2];
if(mode==='setup'){
 const cap=api('capabilities');assert.equal(cap.engine.engineVersion,'0.3.2');
 const opened=host(`(async()=>{const old=app.vault.getAbstractFileByPath(${JSON.stringify(path)});let file=old;if(old){if(await app.vault.read(old)!==${JSON.stringify(source)})throw Error('专用验收文件已有不同内容');}else file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});if(window.__notecalcLayoutTest)return JSON.stringify({opened:true,resumed:true});const previous=app.workspace.activeLeaf,leaf=app.workspace.getLeaf('tab');window.__notecalcLayoutTest={previous,leaf,path:${JSON.stringify(path)}};await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(path)},mode:'source',source:true}});app.workspace.setActiveLeaf(leaf,{focus:true});return JSON.stringify({opened:true});})()`);
 const checks=[];
 for(const modelId of ['partial-layout','block-layout']){
  const snapshot=api('inspect',{target:{vaultId:cap.vaultId,path,modelId}});
  assert.equal(snapshot.status,'error');
  if(modelId==='partial-layout'){assert.equal(snapshot.displayValues.正常收入,'160,000 元');assert.equal(snapshot.values.独立结果,'36');assert.equal(snapshot.nodeStates.关联结果,'blocked');}
  else {assert.equal(snapshot.values.短式,'36');assert.equal(snapshot.values.独立,'42');assert.equal(snapshot.nodeStates.相关,'blocked');}
  checks.push({name:'真实 Worker 局部错误 '+modelId,snapshot});
 }
 fs.writeFileSync(reportFile,JSON.stringify({version:'0.3.2',date:'2026-10-04',checks,opened},null,2));
 console.log(JSON.stringify({opened,checks:checks.length}));
}else if(mode==='native-incomplete'||mode==='native-undo'){
 const cap=api('capabilities'),target={vaultId:cap.vaultId,path,modelId:'partial-layout'};
 const snapshot=api('inspect',{target});
 const state=host('JSON.stringify({source:window.__notecalcLayoutTest.leaf.view.editor.getValue(),annotations:[...window.__notecalcLayoutTest.leaf.view.containerEl.querySelectorAll(".notecalc-inline")].filter(el=>el.getBoundingClientRect().width>0).map(el=>({text:el.textContent,title:el.title}))})');
 assert.equal(snapshot.displayValues.正常收入,'160,000 元');assert.equal(snapshot.values.独立结果,'36');
 assert.equal(Object.hasOwn(snapshot.values,'单行错误'),false);assert.equal(Object.hasOwn(snapshot.values,'关联结果'),false);
 if(mode==='native-incomplete'){assert.equal(snapshot.status,'incomplete');assert.equal(snapshot.nodeStates.单行错误,'incomplete');}
 else {assert.equal(state.source,source);assert.equal(snapshot.status,'error');assert.ok(snapshot.diagnostics.some(d=>d.code==='DIV_ZERO'));}
 const view=cap.views.find(view=>view.target.path===path&&view.target.modelId==='partial-layout'&&view.viewId.startsWith('editor-'));
 assert.ok(view);const shared=api('inspect',{target,viewId:view.viewId});assert.equal(shared.snapshotId,snapshot.snapshotId);assert.equal(shared.viewState.resultsCurrent,true);
 const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));report.checks.push({name:mode,snapshot,shared,state});fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 console.log(JSON.stringify({mode,passed:true,sourceRestored:mode==='native-undo',sharedSnapshot:true}));
}else if(mode==='width'){
 const width=Number(process.argv[3]);
 console.log(host(`JSON.stringify((()=>{const v=window.__notecalcLayoutTest.leaf.view;const content=v.containerEl.querySelector('.cm-content');if(!content)throw Error('编辑器不可见');content.style.width='${width}px';content.style.maxWidth='${width}px';content.style.minWidth='0';v.editor.cm?.requestMeasure();return {width:${width},sourceMode:v.getMode()};})())`));
}else if(mode==='measure'){
 const evidence=host(`JSON.stringify((()=>{const view=window.__notecalcLayoutTest.leaf.view;const container=view.containerEl;const annotations=[...container.querySelectorAll('.notecalc-inline')].map(el=>{const row=el.closest('.notecalc-code-line, li, .cm-line');const a=el.getBoundingClientRect(),b=row.getBoundingClientRect(),style=getComputedStyle(row);const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let node,last;while(node=walker.nextNode()){if(el.contains(node)||node.parentElement.closest('.notecalc-inline')||!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()];if(rects.length)last=rects.at(-1);}return {text:el.textContent,title:el.title,invalid:el.classList.contains('notecalc-invalid'),row:row.textContent,right:a.right,rowRight:b.right,paddingRight:parseFloat(style.paddingRight)||0,top:a.top,bottom:a.bottom,rowTop:b.top,rowBottom:b.bottom,sourceLast:last?{top:last.top,bottom:last.bottom,right:last.right}:null,width:a.width,rowWidth:b.width,display:style.display};}).filter(a=>a.rowWidth>0);return {mode:view.getMode(),contentWidth:container.querySelector(view.getMode()==='source'?'.cm-content':'.markdown-preview-sizer')?.getBoundingClientRect().width,source:view.editor?.getValue(),annotations};})())`);
 const label=process.argv[3];
 assert.ok(evidence.annotations.some(a=>a.text.includes('160,000 元')&&!a.invalid));
 assert.ok(evidence.annotations.some(a=>a.text.includes('36')&&!a.invalid));
 assert.ok(evidence.annotations.some(a=>a.text.includes('除数为零')&&a.invalid));
 assert.ok(evidence.annotations.some(a=>a.text.includes('依赖')&&a.invalid));
 for(const a of evidence.annotations){assert.ok(Math.abs(a.rowRight-a.paddingRight-a.right)<3,JSON.stringify(a));assert.ok(a.bottom<=a.rowBottom+3,'结果越出该行：'+JSON.stringify(a));}
 if(evidence.mode==='source')assert.equal(evidence.source,source);
 if(label.includes('narrow'))assert.ok(evidence.annotations.some(a=>!a.invalid&&a.sourceLast&&a.top>=a.sourceLast.bottom-1),'没有结果换到下一行');
 const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));report.checks=report.checks.filter(check=>check.name!==label);report.checks.push({name:label,evidence});fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 console.log(JSON.stringify({label,mode:evidence.mode,contentWidth:evidence.contentWidth,annotations:evidence.annotations}));
}else if(mode==='live'){
 console.log(host(`(async()=>{const leaf=window.__notecalcLayoutTest.leaf;await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(path)},mode:'source',source:false}});return JSON.stringify({livePreview:true});})()`));
}else if(mode==='reading'){
 console.log(host(`(async()=>{const leaf=window.__notecalcLayoutTest.leaf;await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(path)},mode:'preview'}});return JSON.stringify({mode:leaf.view.getMode()});})()`));
}else if(mode==='reading-width'){
 const width=Number(process.argv[3]);
 console.log(host(`JSON.stringify((()=>{const v=window.__notecalcLayoutTest.leaf.view;const el=v.containerEl.querySelector('.markdown-preview-sizer');el.style.width='${width}px';el.style.maxWidth='${width}px';el.style.minWidth='0';return {width:${width}};})())`));
}else if(mode==='restore'){
 console.log(host(`JSON.stringify((()=>{const state=window.__notecalcLayoutTest;if(state.previous)app.workspace.setActiveLeaf(state.previous,{focus:true});state.leaf.detach();delete window.__notecalcLayoutTest;return {restored:true};})())`));
}
