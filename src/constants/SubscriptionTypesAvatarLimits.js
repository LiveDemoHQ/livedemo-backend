import SubscriptionTypes from './SubscriptionTypes.js'

// Defaults copied onto Subscription at creation, same pattern as membersAllowed.
// A custom deal is an edit of these two fields on that subscription; a plan-type
// change (webhook) resets them. Missing plan types get nothing.
const GROWTH = {
    sessionAvatarTime: 60,
    concurrentSessionAvatars: 1
}

export default {
    [SubscriptionTypes.GROWTH_MONTHLY]: GROWTH,
    [SubscriptionTypes.GROWTH_ANNUALLY]: GROWTH,
    [SubscriptionTypes.TRIAL_GROWTH_MONTHLY]: GROWTH
}
