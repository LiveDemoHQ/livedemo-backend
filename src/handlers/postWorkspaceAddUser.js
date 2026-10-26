import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import postAddUserValidator from '../helpers/validators/oldLambdaRoutes/workspaces/postAddUser.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import Templates from '../helpers/emails/templates/index.js'
import ENV from '../envServer.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let authUserDoc = null
  let requestBody = null
  let activeSubscription = null

  return Promise.resolve().then(async () => {

      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser

      // Validate user has access to workspace
      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)

      // Validate request body
      let validatedBody = helpers.validateBody(req.body, postAddUserValidator)
      requestBody = validatedBody.value
    })
    .then(async () => {
      // Check if user is admin by fetching the workspace
      const workspaceDoc = await Models.Workspace.findOne({ _id: workspaceId }).lean()
      
      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['404_NOT_FOUND'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Workspace not found')
        error.resultResponse = resultResponse
        throw error
      }

      // Validate user is admin
      if (!workspaceDoc.adminUser || workspaceDoc.adminUser.toString() !== authUserDoc._id.toString()) {
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

        let error = new Error('User is not admin')
        error.resultResponse = resultResponse
        throw error
      }
    })
    .then(async () => {
      const email = requestBody.email

      // Get workspace, user, and active subscription
      return Promise.all([
        Models.Workspace.findOne({ _id: workspaceId })
          .populate('users')
          .lean(),
        Models.User.findOne({ email: email })
          .lean(),
        Models.Subscription.findOne({
          $or: [
            { workspaceIds: workspaceId },
            { userId: authUserDoc._id },
          ],
          active: true,
          expired: false,
        }).lean(),
      ])
    })
    .then(([workspaceDoc, userDoc, fetchedSubscription]) => {
      activeSubscription = fetchedSubscription
      const email = requestBody.email

      // Check if user already in workspace
      let userAlreadyInWorkspace = workspaceDoc.users.find(user => user.email === email) || 
                                    workspaceDoc.invitedEmails.find(invitedEmail => invitedEmail === email)
      
      if (userAlreadyInWorkspace) {
        const resultResponse = {
          statusCode: ResponseCodes['400_BAD_REQUEST'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({
            error: 'User already in workspace'
          })
        }

        let error = new Error('User already in workspace')
        error.resultResponse = resultResponse
        throw error
      }

      // Check seat limit against active subscription
      if (activeSubscription) {
        const membersAllowed = activeSubscription.membersAllowed ?? 0
        if (membersAllowed <= 0) {
          const resultResponse = {
            statusCode: ResponseCodes['400_BAD_REQUEST'],
            headers: {
              'Access-Control-Max-Age': 600,
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
              'Access-Control-Allow-Credentials': true,
            },
            body: JSON.stringify({
              error: `Member limit reached. Your plan allows ${membersAllowed} member${membersAllowed === 1 ? '' : 's'}.`
            })
          }
          let error = new Error('Member limit reached')
          error.resultResponse = resultResponse
          throw error
        }
      }

      // If user exists, add to workspace
      if (userDoc) {
        return Models.Workspace.findOneAndUpdate(
          { _id: workspaceId },
          {
            $push: {
              users: userDoc._id
            }
          },
          {
            new: true
          }
        )
        .populate('users adminUser', [
          '_id',
          'name',
          'email',
        ])
        .lean()
        .then((updatedWorkspaceDoc) => {
          // Add workspace to user's workspaces
          return Models.User.findOneAndUpdate(
            { _id: userDoc._id },
            {
              $push: {
                workspaces: workspaceId
              }
            }
          )
          .then(() => {
            return updatedWorkspaceDoc
          })
        })
      } else {
        // User doesn't exist, add to invitedEmails
        return Models.Workspace.findOneAndUpdate(
          { _id: workspaceId },
          {
            $push: {
              invitedEmails: email
            }
          },
          {
            new: true
          }
        )
        .populate('users adminUser', [
          '_id',
          'name',
          'email',
        ])
        .lean()
      }
    })
    .then((workspaceDoc) => {
      if (!workspaceDoc) {
        const resultResponse = {
          statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
          }
        }

        let error = new Error('Workspace not found')
        error.resultResponse = resultResponse
        throw error
      }

      // Send invitation email
      const email = requestBody.email
      const authUrl = `${ENV.SERVER_URL}/register`
      const ownerName = authUserDoc.name

      return Models.User.findOne({ email }, { emailConfig: 1 }).lean()
        .then((inviteeUser) => {
          return sendEmail(Templates.userInvite, {
            ownerName: ownerName,
            newUserEmail: email,
            directLoginLink: authUrl,
            unsubscribeToken: inviteeUser?.emailConfig?.unsubscribeToken || '',
          }, [email], Models)
        })
        .then(async () => {
          if (activeSubscription) {
            await Models.Subscription.findOneAndUpdate(
              { _id: activeSubscription._id },
              { $inc: { membersAllowed: -1 } }
            )
          }

          const resultResponse = {
            statusCode: ResponseCodes['200_OK'],
            headers: {
              'Access-Control-Max-Age': 600,
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
              'Access-Control-Allow-Credentials': true,
            }
          }

          res.set(resultResponse.headers)
          res.status(resultResponse.statusCode)
          res.send(JSON.stringify(workspaceDoc))
        })
    })
    .catch((error) => {
      logger.error(error, { eventName: 'POST_WORKSPACE_ADD_USER_FAILED' })

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
          },
          body: JSON.stringify({
            error: error.message
          })
        }

      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default  handler
