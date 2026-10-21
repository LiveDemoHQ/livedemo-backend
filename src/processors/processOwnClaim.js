import { loadOwnableSource } from '../helpers/own/own.js'
import { newCloneCtx, cloneForClaim } from '../helpers/own/cloneForClaim.js'

// monq job: processOwnClaim { claimId }. Copies a "Make it yours" source into the claimer's workspace.
// The source is re-checked here: it may have been unpublished, disabled or its author's flag revoked since the click
async function runClaim(Models, claimId) {
    const claim = await Models.OwnClaim.findOne({ _id: claimId, status: 'cloning' }).lean()
    if (!claim) return

    try {
        const source = await loadOwnableSource(Models, claim.sourceKind, claim.sourceId)
        if (!source) throw new Error('This is no longer claimable')

        const ctx = newCloneCtx({
            Models,
            userId: claim.userId,
            workspaceId: claim.workspaceId,
            sourceWorkspaceId: source.workspaceId,
            claimId: claim._id
        })
        const clonedId = await cloneForClaim(claim.sourceKind, claim.sourceId, ctx, source)
        await Models.OwnClaim.updateOne({ _id: claim._id }, {
            $set: {
                status: 'completed',
                clonedId,
                completedAt: new Date()
            }
        })
    } catch (err) {
        console.log('processOwnClaim failed', claimId, err)
        await Models.OwnClaim.updateOne({ _id: claim._id }, { $set: { status: 'failed', error: err.message || 'Copy failed' } })
    }
}

function processOwnClaim(sharedConfig, params, callback) {
    const { Models } = sharedConfig

    // Failures are recorded on the claim; a monq retry would clone twice
    return runClaim(Models, params.claimId)
        .then(() => callback(null, { claimId: params.claimId }))
        .catch((err) => {
            console.log('processOwnClaim error', err)
            callback(null, { claimId: params.claimId })
        })
}

const config = {
    queueNames: ['ownClaims'],
    jobNames: ['processOwnClaim'],
    handler: processOwnClaim
}

export default config
