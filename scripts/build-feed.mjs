import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseArchitectures, parseVersion, compareVersion, validateManifest, verifyArchive, hash, appcast, releaseNotesHtml, releaseRepo } from './release-core.mjs'
const token=process.env.GITHUB_TOKEN
const publicKey=process.env.SPARKLE_PUBLIC_ED_KEY
if(!publicKey)throw new Error('公开发布仓库缺少 SPARKLE_PUBLIC_ED_KEY variable。')
const headers=token?{Authorization:`Bearer ${token}`} : {}
async function json(url){const r=await fetch(url,{headers});if(!r.ok)throw new Error(`读取更新数据失败 ${r.status}`);return r.json()}
const releases=[]
for(let page=1;;page++) {
  const batch=await json(`https://api.github.com/repos/${releaseRepo}/releases?per_page=100&page=${page}`)
  releases.push(...batch)
  if(batch.length<100)break
}
const stable=releases.filter(r=>!r.draft&&!r.prerelease).filter(r=>{try{parseVersion(r.tag_name.replace(/^v/,''));return r.tag_name.startsWith('v')}catch{return false}})
stable.sort((a,b)=>compareVersion(b.tag_name.slice(1),a.tag_name.slice(1)))
if(!stable.length)throw new Error('没有正式稳定版本。')
const release=stable[0]
const version=release.tag_name.slice(1)
const asset=(name)=>{const a=release.assets.find(a=>a.name===name);if(!a)throw new Error(`缺少发布文件 ${name}`);return a}
const manifest=await json(asset('release-manifest.json').browser_download_url)
validateManifest(manifest,publicKey)
if(manifest.version!==version)throw new Error('清单版本与 Release 不一致。')
for(const entry of manifest.archives)for(const kind of ['zip','dmg']) {
  const info=entry[kind]
  const response=await fetch(asset(info.name).browser_download_url)
  if(!response.ok)throw new Error(`安装包无法匿名下载 ${info.name}`)
  const bytes=Buffer.from(await response.arrayBuffer())
  if(bytes.length!==info.length || hash(bytes)!==info.sha256)throw new Error('发布文件校验失败。')
  if(kind==='zip')verifyArchive(bytes,info.signature,publicKey)
}
for(const arch of releaseArchitectures) {
  const existing=await fetch(`https://tamaka365.github.io/job-pilot/updates/mac/${arch}/appcast.xml`,{cache:'no-store'})
  if(existing.ok){const old=(await existing.text()).match(/sparkle:version="([^"]+)"/);if(old&&compareVersion(old[1],version)>0)throw new Error('禁止稳定清单回退。')}
  else if(existing.status!==404)throw new Error(`无法确认旧清单 ${existing.status}，拒绝覆盖。`)
  const path=join('site','updates','mac',arch)
  await mkdir(path,{recursive:true})
  await writeFile(join(path,'appcast.xml'),appcast(manifest,arch,release.body || `全职高手 ${version}`))
  await writeFile(join(path,`notes-${version}.html`),releaseNotesHtml(version,release.body || `全职高手 ${version}`))
}
await writeFile('site/index.html',`<!doctype html><meta charset="utf-8"><title>全职高手</title><h1>全职高手 ${version}</h1><p>安装包与版本说明：<a href="https://github.com/${releaseRepo}/releases">GitHub Releases</a></p>`)
await writeFile('site/.nojekyll','')
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`version=${version}\n`)
console.log(`已验证并生成 ${version} 稳定更新清单。`)
