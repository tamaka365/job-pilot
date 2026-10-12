import { pathToFileURL } from 'node:url'
import { parseVersion, compareVersion, releaseRepo } from './release-core.mjs'

export function cleanupCandidates(releases, deployedVersion) {
  parseVersion(deployedVersion)
  const stable = releases.filter(release => {
    if (release.draft || release.prerelease || !release.tag_name.startsWith('v')) return false
    try { parseVersion(release.tag_name.slice(1)); return true } catch { return false }
  }).sort((a, b) => compareVersion(b.tag_name.slice(1), a.tag_name.slice(1)))
  // A newer release may have appeared while Pages was deploying. Wait for its deployment.
  if (stable[0]?.tag_name !== `v${deployedVersion}`) return []
  return stable.slice(2)
}

export async function cleanupReleases(deployedVersion, request) {
  async function list() {
    const releases = []
    for (let page = 1; ; page++) {
      const response = await request(`/releases?per_page=100&page=${page}`)
      if (!response.ok) throw new Error(`无法读取历史版本 ${response.status}，停止清理。`)
      const batch = await response.json()
      releases.push(...batch)
      if (batch.length < 100) return releases
    }
  }
  const candidates = cleanupCandidates(await list(), deployedVersion)
  const deleted = []
  for (const candidate of candidates) {
    // Recheck retention before each deletion; never delete a draft, prerelease or retained version.
    const current = cleanupCandidates(await list(), deployedVersion)
    if (!current.some(release => release.id === candidate.id && release.tag_name === candidate.tag_name)) continue
    const response = await request(`/releases/${candidate.id}`, { method: 'DELETE' })
    if (response.status !== 204 && response.status !== 404) {
      throw new Error(`清理 ${candidate.tag_name} 失败 ${response.status}；新版本与更新清单不受影响。`)
    }
    deleted.push(candidate.tag_name)
  }
  return deleted
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('缺少公开仓库 GITHUB_TOKEN。')
  const deleted = await cleanupReleases(process.env.DEPLOYED_VERSION, (path, options = {}) =>
    fetch(`https://api.github.com/repos/${releaseRepo}${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
    }))
  console.log(deleted.length ? `已删除旧 Release：${deleted.join(', ')}。保留最新两个正式版本。` : '无需清理；版本不足三个或有新版尚待部署。')
}
