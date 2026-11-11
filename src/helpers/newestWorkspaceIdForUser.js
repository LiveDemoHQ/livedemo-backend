// Newest workspace the user is admin of, the same rule as livedemo-ai-api generateDemo.
// Falls back to the user's first workspace for invited members who are admin of none
export default async function newestWorkspaceIdForUser(Models, userDoc) {
    const newest = await Models.Workspace.findOne({ adminUser: userDoc._id }, { _id: 1 })
        .sort({ createdAt: -1 })
        .lean()
    const first = userDoc.workspaces && userDoc.workspaces[0]
    return (newest && newest._id) || (first && (first._id || first)) || null
}
