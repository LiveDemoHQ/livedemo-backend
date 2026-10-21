import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import { decodeReturnPathFromOAuthState } from '../helpers/sanitizeReturnPath.js'
import authUtils from '../helpers/authUtils.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import { syncSignupSubscriber } from '../helpers/sequenzy/sequenzyClient.js'
import Templates from '../helpers/emails/templates/index.js'
import claimBrowserSessionForUser from '../helpers/claimBrowserSessionForUser.js'
import { assertNotSsoEnforced } from '../helpers/sso.js'
import axios from 'axios'
import mongoose from 'mongoose'
const { ObjectId } = mongoose.Types

function shouldRedirectToOnboarding(userDoc) {
    const onboardingGoals = userDoc?.onboarding?.goals
    return !Array.isArray(onboardingGoals) || onboardingGoals.length === 0
}

const handler = function (req, res) {
    let { Models, conn } = req.mongo

    return Promise.resolve().then(async () => {
        const GoogleCreds = ENV.OAUTH2Credentials?.Google
        const code = req.query.code

        if (!GoogleCreds) {
            throw new Error('Google OAuth not configured')
        }

        if (!code) {
            throw new Error('Authorization code not provided')
        }

        // Exchange code for token
        const tokenResponse = await axios.post(GoogleCreds.token_uri, {
            code: code,
            client_id: GoogleCreds.client_id,
            client_secret: GoogleCreds.client_secret,
            redirect_uri: GoogleCreds.redirect_uris[0],
            grant_type: 'authorization_code'
        })

        const tokenRes = tokenResponse.data

        // Get user info from Google
        const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokenRes.access_token}`
            }
        })

        const userRes = userInfoResponse.data

        // Find or create user
        let userObj = await Models.User.findOne({ 'googleProfile.email': userRes.email }).lean()
        await assertNotSsoEnforced(Models, userRes.email, userObj && userObj._id)
        const isNewUser = !userObj

        if (userObj) {
            console.log('user found')
            // Update token data
            await Models.User.findOneAndUpdate(
                { _id: userObj._id },
                {
                    'googleProfile.tokenData': {
                        accessToken: tokenRes.access_token,
                        expiryDate: tokenRes.expiry_date,
                        idToken: tokenRes.id_token,
                        scope: tokenRes.scope,
                        tokenType: tokenRes.token_type,
                    }
                }
            )
            userObj = await Models.User.findOne({ _id: userObj._id }).lean()
        } else {
            // Create new user
            userObj = await new Models.User({
                name: userRes.name,
                email: userRes.email,
                password: '',
                emailVerified: true,
                googleProfile: {
                    email: userRes.email,
                    familyName: userRes.family_name,
                    givenName: userRes.given_name,
                    id: userRes.id,
                    locale: userRes.locale,
                    name: userRes.name,
                    picture: userRes.picture,
                    verifiedEmail: userRes.verified_email,
                    tokenData: {
                        accessToken: tokenRes.access_token,
                        expiryDate: tokenRes.expiry_date,
                        idToken: tokenRes.id_token,
                        scope: tokenRes.scope,
                        tokenType: tokenRes.token_type,
                    }
                }
            }).save()

            // Create workspace for new user
            function capitalizeFirstLetter(str) {
                return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''
            }

            const newWorkspaceDoc = await new Models.Workspace({
                name: `${capitalizeFirstLetter(userObj.googleProfile.givenName)}'s workspace`,
                adminUser: userObj._id,
                users: [userObj._id]
            }).save()

            userObj = await Models.User.findOneAndUpdate(
                { _id: userObj._id },
                { $push: { workspaces: newWorkspaceDoc._id } },
                { new: true }
            ).lean()

            // Clone onboarding demo into the new workspace
            const demoStoryId = ENV.ONBOARDING_DEMO_STORY_ID
            const demoWorkspaceId = ENV.ONBOARDING_DEMO_WORKSPACE_ID

            if (demoStoryId && demoWorkspaceId) {
                const localUserId = userObj._id
                const localWorkspaceId = newWorkspaceDoc._id

                const storyDemoFullDoc = await Models.Story.findOne({
                    _id: demoStoryId,
                    workspaceId: demoWorkspaceId
                }).populate('screens').lean()

                if (storyDemoFullDoc) {
                    await Promise.resolve(storyDemoFullDoc)
                        .then((storyDemoFullDoc) => {

                            let uniqueObjId = new ObjectId()
                            let newStoryId = uniqueObjId

                            let promisesArray = []

                            for (let i = 0; i < storyDemoFullDoc.screens.length; i++) {
                                let screen = storyDemoFullDoc.screens[i]
                                screen._id = new ObjectId()

                                promisesArray.push(new Models.Screen({
                                    ...screen,
                                    storyId: newStoryId,
                                    workspaceId: localWorkspaceId
                                }).save())
                            }

                            return Promise.all(promisesArray)
                                .then((screensArray) => {
                                    let screenIds = screensArray.map(scr => scr._id)

                                    return new Models.Story({
                                        ...storyDemoFullDoc,
                                        _id: newStoryId,
                                        userId: localUserId,
                                        workspaceId: localWorkspaceId,
                                        screens: screenIds
                                    }).save()
                                })
                        })
                }
            }

            // SES keeps day-0 welcome; Sequenzy sequence should start at Day 1+.
            void syncSignupSubscriber(userObj, Models, { source: 'google' }).catch(() => {})

            // Send welcome email (if template exists)
            try {
                if (Templates.newAutoGenAccountCreated) {
                    await sendEmail(Templates.newAutoGenAccountCreated, {
                        name: userObj.googleProfile.givenName,
                        unsubscribeToken: userObj.emailConfig?.unsubscribeToken || '',
                    }, [userObj.googleProfile.email], Models)
                }
            } catch (err) {
                console.log('Email send error:', err)
            }
        }

        // Check for workspaces with invited emails
        const allWorkspaces = await Models.Workspace.find({}, { _id: 1, invitedEmails: 1 }).lean()
        let userWorkspaces = []

        for (let i = 0; i < allWorkspaces.length; i++) {
            let currentWorkspace = allWorkspaces[i]
            if (currentWorkspace.invitedEmails && currentWorkspace.invitedEmails.includes(userObj.email)) {
                userWorkspaces.push(currentWorkspace._id)
            }
        }

        if (userObj.workspaces && userObj.workspaces.length !== 0) {
            for (let i = 0; i < userObj.workspaces.length; i++) {
                let wrkspaceId = userObj.workspaces[i]
                if (wrkspaceId) {
                    const workspaceIdStr = wrkspaceId.toString()
                    if (!userWorkspaces.some(w => w.toString() === workspaceIdStr)) {
                        userWorkspaces.push(wrkspaceId)
                    }
                }
            }
        }

        // Update user workspaces - only add new ones that aren't already there
        const existingWorkspaceIds = userObj.workspaces ? userObj.workspaces.map(w => w.toString()) : []
        const newWorkspaceIds = userWorkspaces.filter(w => !existingWorkspaceIds.includes(w.toString()))

        let userDoc = userObj
        if (newWorkspaceIds.length > 0) {
            userDoc = await Models.User.findOneAndUpdate(
                { _id: userObj._id },
                { $push: { workspaces: { $each: newWorkspaceIds } } },
                { new: true }
            ).lean()
        }

        // Create auth token - need to get user document (not lean) for token creation
        const userDocForToken = await Models.User.findOne({ _id: userDoc._id })
        const authTokenDoc = await authUtils.createTokenForUser(userDocForToken, Models.AuthToken)

        // Redirect to frontend with token (return path from OAuth state set at google-link)
        const decodedState = decodeReturnPathFromOAuthState(req.query.state)
        const returnPath = decodedState.returnPath
        await claimBrowserSessionForUser(decodedState.browserSessionId, userDoc, Models)

        const redirectPath = shouldRedirectToOnboarding(userDoc) ? '/onboarding' : returnPath
        const encodedPage = encodeURIComponent(redirectPath)
        const redirectUrl = `${ENV.SERVER_URL}/auth/?page=${encodedPage}&token=${authTokenDoc.token}${isNewUser ? '&signup=google' : ''}`

        const resultResponse = {
            statusCode: ResponseCodes['302_FOUND'],
            headers: {
                'Location': redirectUrl,
                'Access-Control-Max-Age': 600,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                // Required for CORS support to work
                'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
            }
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.redirect(redirectUrl)
    })
        .catch((error) => {
            console.log(error)
            if (error.ssoRedirectUrl) return res.redirect(error.ssoRedirectUrl)

            let resultResponse
            if (error.resultResponse) {

                resultResponse = error.resultResponse
            } else {


                resultResponse = {
                    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                    headers: {
                        'Access-Control-Max-Age': 600,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                        // Required for CORS support to work
                        'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                    }
                }

            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send('')
        })
}

export default handler
