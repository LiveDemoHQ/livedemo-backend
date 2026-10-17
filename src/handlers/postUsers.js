import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import userValidators from '../helpers/validators/userValidators.js'
import authUtils from '../helpers/authUtils.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import Templates from '../helpers/emails/templates/index.js'
import { cloneUrlDemoStoriesForUser } from '../helpers/cloneUrlDemoStoriesForUser.js'
import {
  createAndSendEmailVerificationCode,
  getPostAuthRedirectPath,
} from '../helpers/emailHelpers.js'
import { assertNotSsoEnforced } from '../helpers/sso.js'
import mongoose from 'mongoose'
const { ObjectId } = mongoose.Types

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let requestBody = req.body

  return Promise.resolve().then(() => {
      if (!requestBody) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Invalid request body')
        error.resultResponse = resultResponse
        throw error
      }

      // Validate signup form
      let validationResult = userValidators.validateSignupForm(requestBody)

      if (!validationResult.success) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify(validationResult)
        }

        let error = new Error('Validation failed')
        error.resultResponse = resultResponse
        throw error
      }
    })
    .then(() => assertNotSsoEnforced(Models, requestBody.email))
    .then(() => {
      const email = requestBody.email
      const password = requestBody.password
      const name = requestBody.fullName

      const fullNameArray = name ? name.split(' ') : []
      const firstName = fullNameArray.length ? fullNameArray[0] : name

      const userData = {
        email,
        password,
        name,
        emailVerified: false
      }

      // Save user to database (password will be hashed by User model pre-save hook)
      return new Models.User(userData).save()
    })
    .then(async (userData) => {
      const userNameForWorkspace = userData.name.split(' ')[0]

      function capitalizeFirstLetter(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''
      }

      // Create workspace for new user
      const newWorkspaceDoc = await new Models.Workspace({
        name: `${capitalizeFirstLetter(userNameForWorkspace)}'s workspace`,
        adminUser: userData._id,
        users: [userData._id]
      }).save()

      const updatedUser = await Models.User.findOneAndUpdate(
        { _id: userData._id },
        { $push: { workspaces: newWorkspaceDoc._id } },
        { new: true }
      )

      // Clone onboarding demo into the new workspace
      const demoStoryId = ENV.ONBOARDING_DEMO_STORY_ID
      const demoWorkspaceId = ENV.ONBOARDING_DEMO_WORKSPACE_ID

      if (demoStoryId && demoWorkspaceId) {
        const localUserId = userData._id
        const localWorkspaceId = newWorkspaceDoc._id

        const storyDemoFullDoc = await Models.Story.findOne({
          _id: demoStoryId,
          workspaceId: demoWorkspaceId
        }).populate('screens').lean()

        if (storyDemoFullDoc) {
          const newStoryId = new ObjectId()

          const screensArray = await Promise.all(
            storyDemoFullDoc.screens.map((screen) => {
              screen._id = new ObjectId()
              return new Models.Screen({
                ...screen,
                storyId: newStoryId,
                workspaceId: localWorkspaceId,
              }).save()
            })
          )

          const screenIds = screensArray.map(scr => scr._id)

          if(storyDemoFullDoc.createdAt) {
            delete storyDemoFullDoc.createdAt
          }
          if(storyDemoFullDoc.updatedAt) {
            delete storyDemoFullDoc.updatedAt
          }
          
          await new Models.Story({
            ...storyDemoFullDoc,
            _id: newStoryId,
            userId: localUserId,
            workspaceId: localWorkspaceId,
            screens: screenIds,
          }).save()
        }
      }

      return updatedUser
    })
    .then((userData) => {
      // Check for workspaces with invited emails
      return Models.Workspace.find({}, { _id: 1, invitedEmails: 1 }).lean()
        .then((allWorkspaces) => {
          let userWorkspaces = []
          for (let i = 0; i < allWorkspaces.length; i++) {
            let currentWorkspace = allWorkspaces[i]
            if (currentWorkspace.invitedEmails && currentWorkspace.invitedEmails.includes(userData.email)) {
              userWorkspaces.push(currentWorkspace._id)
            }
          }

          if (userWorkspaces.length > 0) {
            return Models.User.findOneAndUpdate(
              { _id: userData._id },
              { $push: { workspaces: { $each: userWorkspaces } } },
              { new: true }
            )
          } else {
            return userData
          }
        })
    })
    // .then((newUserData) => {
    //   // Send welcome email (if template exists)
    //   const fullNameArray = requestBody.fullName ? requestBody.fullName.split(' ') : []
    //   const firstName = fullNameArray.length ? fullNameArray[0] : requestBody.fullName

    //   if (Templates.newAutoGenAccountCreated) {
    //     return sendEmail(Templates.newAutoGenAccountCreated, {
    //       name: firstName,
    //       unsubscribeToken: newUserData.emailConfig?.unsubscribeToken || '',
    //     }, [requestBody.email], Models)
    //       .then(() => newUserData)
    //       .catch((err) => {
    //         console.log('Email send error:', err)
    //         return newUserData
    //       })
    //   } else {
    //     return Promise.resolve(newUserData)
    //   }
    // })
    .then((newUserData) => {
      return createAndSendEmailVerificationCode(newUserData, Models)
        .catch((err) => {
          console.log('Email verification code send error:', err)
        })
        .then(() => newUserData)
    })
    .then((newUserData) => {
      // Convert to JSON for token creation
      const savedUserData = newUserData.toJSON ? newUserData.toJSON() : newUserData

      // Create auth token
      return authUtils.createTokenForUser(savedUserData, Models.AuthToken)
        .then((authTokenData) => {
          return {
            savedUserData,
            authTokenData
          }
        })
    })
    .then(({ savedUserData, authTokenData }) => {
      const browserSessionId = requestBody.browserSessionId || null
      if(browserSessionId) {
        return cloneUrlDemoStoriesForUser(browserSessionId, savedUserData, Models)
          .catch(err => console.error('[postUsers] cloneUrlDemoStoriesForUser error', err))
          .then(() => ({ savedUserData, authTokenData }))
      } else {
        return Promise.resolve({ savedUserData, authTokenData })
      }
    })
    .then(({ savedUserData, authTokenData }) => {
      const redirectPath = getPostAuthRedirectPath(savedUserData)
      const resultResponse = {
        statusCode: ResponseCodes['200_OK'],
        headers: {
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
          // Required for CORS support to work
          'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(JSON.stringify({
        id: savedUserData._id.toString(),
        name: savedUserData.name,
        email: savedUserData.email,
        timezone: savedUserData.timezone,
        featureFlags: savedUserData.featureFlags,
        emailVerified: savedUserData.emailVerified === true,
        token: authTokenData.token,
        redirectPath
      }))
    })
    .catch((error) => {
      console.log(error)

      let resultResponse
      let checkForDuplicateError = userValidators.handleMongoDuplicateError(error)
      
      if (checkForDuplicateError.error) {
        resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          },
          body: JSON.stringify({ error: checkForDuplicateError.error })
        }
      } else if (error.resultResponse) {
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
      res.send(resultResponse.body || '')
    })
}

export default  handler
