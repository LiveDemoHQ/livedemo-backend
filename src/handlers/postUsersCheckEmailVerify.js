import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import limiter from '../helpers/rateLimiter.js'
import checkEmailVerifyValidator from '../helpers/validators/users/checkEmailVerifyValidator.js'
import { EmailVerificationCodeStatuses } from '../models/EmailVerificationCode.js'
import {
  getPostAuthRedirectPath,
} from '../helpers/emailHelpers.js'
import { sendEmail } from '../helpers/emails/emailsSender.js'
import Templates from '../helpers/emails/templates/index.js'
import { syncSignupSubscriber } from '../helpers/sequenzy/sequenzyClient.js'

const handler = function (req, res) {
  let { Models } = req.mongo

  let requestBody = null
  let clientId = req.headers && req.headers.clientid ? req.headers.clientid : 'no-clientid'

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser, authToken }) => {
      return limiter(
        clientId,
        authToken,
        (errorResponse) => {
          const failedRateLimitError = new Error('Rate limit exceeded')
          failedRateLimitError.resultResponse = errorResponse
          throw failedRateLimitError
        },
        5
      ).then(() => ({ authUser, authToken }))
    })
    .then(({ authUser }) => {
      const validatedBody = helpers.validateBody(req.body, checkEmailVerifyValidator)
      requestBody = validatedBody.value

      if (authUser.emailVerified === true) {
        const resultResponse = {
          statusCode: ResponseCodes['200_OK'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        return getPostAuthRedirectPath(authUser, Models).then((redirectPath) => {
          res.send(JSON.stringify({
            emailVerified: true,
            alreadyVerified: true,
            redirectPath,
          }))
        })
      }

      return Models.EmailVerificationCode.findOne({
        userId: authUser._id,
        code: requestBody.code,
        status: EmailVerificationCodeStatuses.ACTIVE,
      }).then((verificationDoc) => {
        if (!verificationDoc) {
          const resultResponse = {
            statusCode: ResponseCodes['400_BAD_REQUEST'],
            headers: {
              'Access-Control-Max-Age': 600,
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
              'Access-Control-Allow-Credentials': true,
            },
            body: JSON.stringify({
              error: true,
              message: 'Invalid or expired verification code',
            }),
          }

          const invalidCodeError = new Error('Invalid verification code')
          invalidCodeError.resultResponse = resultResponse
          throw invalidCodeError
        }

        return Models.EmailVerificationCode.findOneAndUpdate(
          { _id: verificationDoc._id },
          { status: EmailVerificationCodeStatuses.DEACTIVATED },
          { new: true }
        ).then(() => {
          return Models.User.findOneAndUpdate(
            { _id: authUser._id },
            { emailVerified: true },
            { new: true }
          )
        })
      })
    })
    .then((updatedUser) => {
      if (!updatedUser) {
        return
      }

      const fullNameArray = updatedUser.name ? updatedUser.name.split(' ') : []
      const firstName = fullNameArray.length ? fullNameArray[0] : updatedUser.name

      // SES keeps day-0 welcome; Sequenzy sequence should start at Day 1+.
      void syncSignupSubscriber(updatedUser, Models, { source: 'password' }).catch(() => {})

      if (Templates.newAutoGenAccountCreated) {
        return sendEmail(Templates.newAutoGenAccountCreated, {
          name: firstName,
          unsubscribeToken: updatedUser.emailConfig?.unsubscribeToken || '',
        }, [updatedUser.email], Models)
          .catch((err) => {
            console.log('Welcome email send error:', err)
          })
          .then(() => updatedUser)
      }

      return Promise.resolve(updatedUser)
    })
    .then((updatedUser) => {
      if (!updatedUser) {
        return
      }

      return getPostAuthRedirectPath(updatedUser, Models).then((redirectPath) => {
        const resultResponse = {
          statusCode: ResponseCodes['200_OK'],
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
        }

        res.set(resultResponse.headers)
        res.status(resultResponse.statusCode)
        res.send(JSON.stringify({
          emailVerified: true,
          redirectPath,
          id: updatedUser._id,
          email: updatedUser.email,
          name: updatedUser.name,
        }))
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
          headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({
            message: 'Something wrong happened',
            error: true,
            errorMessage: error.message,
          }),
        }
      }

      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
