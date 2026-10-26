import ResponseCodes from '../constants/ResponseCodes.js'
import { getFoundingPromoStatus } from '../helpers/foundingPromo.js'

import logger from '../helpers/logger.js'

const CORS_HEADERS = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

/** Public — banner on preview pages has no auth. */
const handler = async function (req, res) {

  res.set(CORS_HEADERS)
  if (req.method === 'OPTIONS') {

    return res.status(ResponseCodes['200_OK']).end()
  }

  try {

    const { Models } = req.mongo
    const status = await getFoundingPromoStatus(Models)
    return res.status(ResponseCodes['200_OK']).json(status)
  } catch (err) {

    logger.error('[getFoundingPromo]', { eventName: 'GET_FOUNDING_PROMO_FAILED', err: err })
    return res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR']).json({
      error: true,
      message: 'Could not load founding promo status'
    })
  }
}

export default handler
