import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import authUtils from '../helpers/authUtils.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import { syncSignupSubscriber } from '../helpers/sequenzy/sequenzyClient.js'
import Templates from '../helpers/emails/templates/index.js'
import { assertNotSsoEnforced } from '../helpers/sso.js'
import claimBrowserSessionForUser from '../helpers/claimBrowserSessionForUser.js'
import mongoose from 'mongoose'
const { ObjectId } = mongoose.Types

let googleAuthClient = null

async function getGoogleAuthClient() {
  if (!googleAuthClient) {
    const { OAuth2Client } = await import('google-auth-library')
    const GoogleCreds = ENV.OAUTH2Credentials?.Google
    googleAuthClient = new OAuth2Client(GoogleCreds.client_id)
  }
  return googleAuthClient
}

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

function shouldRedirectToOnboarding(userDoc) {
  const onboardingGoals = userDoc?.onboarding?.goals
  return !Array.isArray(onboardingGoals) || onboardingGoals.length === 0
}

const handler = function (req, res) {
  let { Models } = req.mongo

  return Promise.resolve().then(async () => {
    const GoogleCreds = ENV.OAUTH2Credentials?.Google
    const { credential } = req.body

    if (!GoogleCreds) {
      throw new Error('Google OAuth not configured')
    }

    if (!credential) {
      const err = new Error('credential is required')
      err.resultResponse = {
        statusCode: ResponseCodes['400_BAD_REQUEST'],
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'credential is required' })
      }
      throw err
    }

    // Verify the Google ID token
    const client = await getGoogleAuthClient()
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GoogleCreds.client_id,
    })
    const payload = ticket.getPayload()

    const googleId = payload['sub']
    const email = payload['email']
    const name = payload['name']
    const givenName = payload['given_name']
    const familyName = payload['family_name']
    const picture = payload['picture']
    const verifiedEmail = payload['email_verified']
    
    // Find or create user
    let userObj = await Models.User.findOne({ 'googleProfile.email': email }).lean()
    await assertNotSsoEnforced(Models, email, userObj && userObj._id)
    const isNewUser = !userObj

    if (userObj) {
      await Models.User.findOneAndUpdate(
        { _id: userObj._id },
        {
          'googleProfile.tokenData': {
            idToken: credential,
          }
        }
      )
      userObj = await Models.User.findOne({ _id: userObj._id }).lean()
    } else {
      userObj = await new Models.User({
        name,
        email,
        password: '',
        emailVerified: true,
        googleProfile: {
          email,
          familyName,
          givenName,
          id: googleId,
          name,
          picture,
          verifiedEmail,
          tokenData: {
            idToken: credential,
          }
        }
      }).save()

      function capitalizeFirstLetter(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''
      }

      const newWorkspaceDoc = await new Models.Workspace({
        name: `${capitalizeFirstLetter(givenName)}'s workspace`,
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
          const uniqueObjId = new ObjectId()
          const newStoryId = uniqueObjId
          const promisesArray = []

          for (let i = 0; i < storyDemoFullDoc.screens.length; i++) {
            let screen = storyDemoFullDoc.screens[i]
            screen._id = new ObjectId()
            promisesArray.push(new Models.Screen({
              ...screen,
              storyId: newStoryId,
              workspaceId: localWorkspaceId,
            }).save())
          }

          const screensArray = await Promise.all(promisesArray)
          const screenIds = screensArray.map(scr => scr._id)

          await new Models.Story({
            ...storyDemoFullDoc,
            _id: newStoryId,
            userId: localUserId,
            workspaceId: localWorkspaceId,
            screens: screenIds
          }).save()
        }
      }

      // SES keeps day-0 welcome; Sequenzy sequence should start at Day 1+.
      void syncSignupSubscriber(userObj, Models, { source: 'google' }).catch(() => {})

      // Send welcome email (if template exists)
      try {
        if (Templates.newAutoGenAccountCreated) {
          await sendEmail(Templates.newAutoGenAccountCreated, {
            name: givenName,
            unsubscribeToken: userObj.emailConfig?.unsubscribeToken || '',
          }, [email], Models)
        }
      } catch (err) {
        console.log('Email send error:', err)
      }
    }

    // Merge workspaces from invites
    const allWorkspaces = await Models.Workspace.find({}, { _id: 1, invitedEmails: 1 }).lean()
    let userWorkspaces = []

    for (let i = 0; i < allWorkspaces.length; i++) {
      const currentWorkspace = allWorkspaces[i]
      if (currentWorkspace.invitedEmails && currentWorkspace.invitedEmails.includes(userObj.email)) {
        userWorkspaces.push(currentWorkspace._id)
      }
    }

    if (userObj.workspaces && userObj.workspaces.length !== 0) {
      for (let i = 0; i < userObj.workspaces.length; i++) {
        const wrkspaceId = userObj.workspaces[i]
        if (wrkspaceId) {
          const workspaceIdStr = wrkspaceId.toString()
          if (!userWorkspaces.some(w => w.toString() === workspaceIdStr)) {
            userWorkspaces.push(wrkspaceId)
          }
        }
      }
    }

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

    await claimBrowserSessionForUser(req.body.browserSessionId, userDoc, Models)

    // Create auth token
    const userDocForToken = await Models.User.findOne({ _id: userDoc._id })
    const authTokenDoc = await authUtils.createTokenForUser(userDocForToken, Models.AuthToken)

    const redirectPath = shouldRedirectToOnboarding(userDoc) ? '/onboarding' : '/'
    const encodedPage = encodeURIComponent(redirectPath)
    const redirectUrl = `${ENV.SERVER_URL}/auth/?page=${encodedPage}&token=${authTokenDoc.token}${isNewUser ? '&signup=google' : ''}`

    res.set({ ...CORS_HEADERS, 'Content-Type': 'application/json' })
    res.status(ResponseCodes['200_OK'])
    res.json({
      success: true,
      token: authTokenDoc.token,
      redirectUrl,
      redirectPath,
      id: userDoc._id,
      email: userDoc.email,
      name: userDoc.name,
      timezone: userDoc.timezone || '',
      featureFlags: userDoc.featureFlags,
    })
  })
  .catch((error) => {
    console.log(error)

    let resultResponse
    if (error.resultResponse) {
      resultResponse = error.resultResponse
    } else {
      resultResponse = {
        statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Internal server error' })
      }
    }

    res.set(resultResponse.headers)
    res.status(resultResponse.statusCode)
    res.send(resultResponse.body || '')
  })
}

export default handler
