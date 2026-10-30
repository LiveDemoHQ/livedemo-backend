import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import { userHasDemos } from '../helpers/emailHelpers.js'
import logger from '../helpers/logger.js'

// GET /users/onboarding-status -> { hasDemos }. The web app keeps users on /onboarding until this is true.
const handler = function (req, res) {
  const { Models } = req.mongo

  return Promise.resolve()
    .then(() => helpers.authReq(req, Models))
    .then(({ authUser }) => userHasDemos(Models, authUser))
    .then((hasDemos) => {
      res.set({
        'Access-Control-Max-Age': 600,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
        'Access-Control-Allow-Credentials': true,
      })
      res.status(ResponseCodes['200_OK'])
      res.send(JSON.stringify({ hasDemos }))
    })
    .catch((error) => {
      logger.error('getUsersOnboardingStatus failed', { eventName: 'GET_USERS_ONBOARDING_STATUS_FAILED', err: error })
      const resultResponse = error.resultResponse || { statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'], headers: {} }
      res.set(resultResponse.headers)
      res.status(resultResponse.statusCode)
      res.send(resultResponse.body || '')
    })
}

export default handler
