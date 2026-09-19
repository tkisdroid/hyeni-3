/** 최신 소스로 새로 빌드하고 지도 배포 검사를 통과한 결과만 운영 Pages에 올린다. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { assertPagesSourceCurrent, inspectPagesMapBundle } from "./verify-pages-map-bundle.mjs";

const root=resolve(import.meta.dirname,"..");
function run(command,args,cwd){
  const result=spawnSync(command,args,{cwd,stdio:"inherit",env:process.env});
  if(result.error||result.status!==0)throw new Error("Pages 빌드·배포 명령이 실패했습니다.");
}
assertPagesSourceCurrent(root);
run(process.platform==="win32"?"npm.cmd":"npm",["run","build"],root);
console.log(JSON.stringify(inspectPagesMapBundle(resolve(root,"dist")),null,2));
// Worker 전용 .env가 Pages OAuth를 덮지 않도록 자격 파일이 없는 임시 경로에서 실행한다.
const deployDir=mkdtempSync(join(tmpdir(),"hyeni-pages-deploy-"));
try{
  run(process.execPath,[resolve(root,"node_modules/wrangler/bin/wrangler.js"),"pages","deploy",resolve(root,"dist"),"--project-name=hyeni-calendar","--branch=main","--commit-dirty=true"],deployDir);
}finally{rmSync(deployDir,{recursive:true,force:true})}
