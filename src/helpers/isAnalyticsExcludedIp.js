// Workspace setting (e.g. the team's own office IPs): no analytics Session / recording for these visitors.
// `ip` must be the same one stored in clientIpData, so what Analytics shows is what users paste into the list.
// ponytail: exact IP match only. Upgrade: CIDR ranges for rotating IPv6 / office blocks.
export default function isAnalyticsExcludedIp(ip, Models, workspaceId) {
  return Models.Workspace.findOne({ _id: workspaceId }, { analyticsExcludedIps: 1 }).lean()
    .then(workspace => !!workspace && !!ip && (workspace.analyticsExcludedIps || []).includes(ip.trim()))
}
