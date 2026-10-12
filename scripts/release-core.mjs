import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export const releaseRepo = 'tamaka365/job-pilot'
export const releaseArchitectures = ['arm64']
export function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本号必须是稳定的 major.minor.patch。')
  return value.split('.').map(BigInt)
}
export function compareVersion(a, b) {
  const aa=parseVersion(a), bb=parseVersion(b)
  for(let i=0;i<3;i++) if(aa[i]!==bb[i]) return aa[i]>bb[i]?1:-1
  return 0
}
export function privateKeyFromSeed(seed) {
  const bytes=Buffer.from(seed.trim(),'base64')
  if(bytes.length!==32) throw new Error('Sparkle 私钥必须是官方工具导出的 32 字节 seed（Base64）。')
  return createPrivateKey({ key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),bytes]),format:'der',type:'pkcs8' })
}
export function rawPublicKey(key) { return createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('base64') }
export function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }
export function signArchive(bytes, seed, expectedPublicKey) {
  const key=privateKeyFromSeed(seed)
  if(rawPublicKey(key)!==expectedPublicKey) throw new Error('签名私钥与应用公钥不匹配。')
  return sign(null,bytes,key).toString('base64')
}
export function verifyArchive(bytes, signature, publicKey) {
  const key=Buffer.from(publicKey,'base64'), sig=Buffer.from(signature,'base64')
  if(key.length!==32 || sig.length!==64) throw new Error('无效的 Ed25519 公钥或签名。')
  if(!verify(null,bytes,{key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key]),format:'der',type:'spki'},sig)) throw new Error('更新包签名验证失败。')
}
export function artifactNames(version,arch) {
  parseVersion(version)
  if(!releaseArchitectures.includes(arch)) throw new Error('Unsupported architecture.')
  const prefix=`job-pilot-${version}-mac-${arch}`
  return {zip:`${prefix}.zip`,dmg:`${prefix}.dmg`}
}
export function validateManifest(manifest, expectedPublicKey) {
  parseVersion(manifest.version)
  if(manifest.schemaVersion!==1 || manifest.publicKey!==expectedPublicKey || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw new Error('发布清单身份不正确。')
  if(!Array.isArray(manifest.archives) || manifest.archives.length!==1 || manifest.archives[0].arch!=='arm64') throw new Error('发布清单必须仅包含 arm64 架构。')
  for(const entry of manifest.archives) {
    const names=artifactNames(manifest.version,entry.arch)
    if(entry.zip.name!==names.zip || entry.dmg.name!==names.dmg || !Number.isSafeInteger(entry.zip.length) || entry.zip.length<=0 || !Number.isSafeInteger(entry.dmg.length) || entry.dmg.length<=0 || !/^[a-f0-9]{64}$/.test(entry.zip.sha256) || !/^[a-f0-9]{64}$/.test(entry.dmg.sha256) || Buffer.from(entry.zip.signature,'base64').length!==64) throw new Error('发布文件清单无效。')
  }
}
const escape=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
export function releaseNotesHtml(version, notes) {
  parseVersion(version)
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>JobPilot ${version}</title><body><h1>JobPilot ${version}</h1><pre style="white-space:pre-wrap;font-family:system-ui">${escape(notes)}</pre></body></html>`
}
export function appcast(manifest,arch,notes='') {
  validateManifest(manifest,manifest.publicKey)
  const item=manifest.archives.find(a=>a.arch===arch)
  if(!item)throw new Error('Missing architecture.')
  const url=`https://github.com/${releaseRepo}/releases/download/v${manifest.version}/${item.zip.name}`
  const notesUrl=`https://tamaka365.github.io/job-pilot/updates/mac/${arch}/notes-${manifest.version}.html`
  return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>JobPilot macOS ${arch}</title><item><title>JobPilot ${manifest.version}</title><description>${escape(notes)}</description><sparkle:releaseNotesLink>${notesUrl}</sparkle:releaseNotesLink><sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion><enclosure url="${escape(url)}" sparkle:version="${manifest.version}" sparkle:shortVersionString="${manifest.version}" sparkle:edSignature="${escape(item.zip.signature)}" length="${item.zip.length}" type="application/octet-stream" /></item></channel></rss>\n`
}
