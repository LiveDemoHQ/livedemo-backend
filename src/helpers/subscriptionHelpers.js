import SubscriptionTypes from '../constants/SubscriptionTypes.js'
import SubscriptionTypesAvatarLimits from '../constants/SubscriptionTypesAvatarLimits.js'

function toIdString(id) {
  if (!id) return null
  return (id._id ?? id).toString()
}

/** Collect workspace ids from workspaceIds array and legacy workspaceId field. */
export function getSubscriptionWorkspaceIds(subscription) {
  if (!subscription) return []

  const seen = new Set()
  const ids = []

  const addId = (id) => {
    const str = toIdString(id)
    if (!str || seen.has(str)) return
    seen.add(str)
    ids.push(id._id ?? id)
  }

  if (Array.isArray(subscription.workspaceIds)) {
    subscription.workspaceIds.forEach(addId)
  }

  if (subscription.workspaceId) {
    addId(subscription.workspaceId)
  }

  return ids
}

/** Mongo filter: subscriptions linked to a workspace (supports legacy workspaceId). */
export function subscriptionWorkspaceFilter(workspaceId) {
  return {
    $or: [
      { workspaceIds: workspaceId },
      { workspaceId },
    ],
  }
}

/** Mongo filter: subscriptions linked to any of the given workspaces. */
export function subscriptionsForWorkspacesFilter(workspaceIds) {
  const ids = getSubscriptionWorkspaceIds({ workspaceIds })
  if (!ids.length) {
    return { _id: null }
  }

  return {
    $or: [
      { workspaceIds: { $in: ids } },
      { workspaceId: { $in: ids } },
    ],
  }
}

/** Ensure API responses expose workspaceIds only (no legacy workspaceId). */
export function normalizeSubscription(subscription) {
  if (!subscription) return subscription

  const doc = typeof subscription.toObject === 'function'
    ? subscription.toObject()
    : { ...subscription }

  const seen = new Set()
  const workspaceIds = []

  const addEntry = (entry) => {
    if (!entry) return
    const str = toIdString(entry)
    if (!str || seen.has(str)) return
    seen.add(str)

    if (entry && typeof entry === 'object' && entry.name) {
      workspaceIds.push({
        _id: entry._id ?? entry,
        name: entry.name,
      })
    } else {
      workspaceIds.push(entry._id ?? entry)
    }
  }

  if (Array.isArray(doc.workspaceIds)) {
    doc.workspaceIds.forEach(addEntry)
  }

  if (doc.workspaceId) {
    addEntry(doc.workspaceId)
  }

  doc.workspaceIds = workspaceIds
  delete doc.workspaceId

  return doc
}

export function normalizeSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) return []
  return subscriptions.map(normalizeSubscription)
}

export function getPrimarySubscriptionWorkspaceId(subscription) {
  const ids = getSubscriptionWorkspaceIds(subscription)
  return ids[0] ?? null
}

/** Deactivate all user subscriptions except the one that should be active. */
export async function setActiveUserSubscription(Models, userId, activeSubscriptionId) {
  if (!userId || !activeSubscriptionId) return

  const userObjectId = userId._id ?? userId
  const activeId = activeSubscriptionId._id ?? activeSubscriptionId

  await Models.Subscription.updateMany(
    {
      userId: userObjectId,
      _id: { $ne: activeId },
    },
    { $set: { active: false } }
  )

  await Models.Subscription.updateOne(
    { _id: activeId },
    { $set: { active: true } }
  )
}

/** Avatar limits stored on a new subscription. Unknown plans get 0 / 0 (no live avatar on our keys). */
export function avatarLimitsFor(type) {
  return SubscriptionTypesAvatarLimits[type] || { sessionAvatarTime: 0, concurrentSessionAvatars: 0 }
}

export const PAID_PLAN_USER_FEATURE_FLAGS = {
  'featureFlags.noDemoLimit': true,
  'featureFlags.advanceInsights': true,
  'featureFlags.allowRemoveWatermark': true,
  'featureFlags.showMp4GifsExport': true,
  'featureFlags.allowForms': true,
  'featureFlags.allowEmbed': true,
  'featureFlags.allowPersonalization': true,
  'featureFlags.allowShowcases': true,
}

const AI_AGENTS_SUBSCRIPTION_TYPES = new Set([
  SubscriptionTypes.GROWTH_MONTHLY,
  SubscriptionTypes.GROWTH_ANNUALLY,
  SubscriptionTypes.TRIAL_GROWTH_MONTHLY,
])

/** Enable paid-plan feature flags on the user after any plan purchase. AI agents are Growth-only. */
export async function enablePaidPlanUserFeatureFlags(Models, userId, subscriptionType) {
  if (!userId) return

  const userObjectId = userId._id ?? userId

  await Models.User.findOneAndUpdate(
    { _id: userObjectId },
    {
      $set: {
        ...PAID_PLAN_USER_FEATURE_FLAGS,
        'featureFlags.allowAIAgents': AI_AGENTS_SUBSCRIPTION_TYPES.has(subscriptionType),
      },
    }
  )
}
