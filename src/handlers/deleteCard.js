import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import EventReporter from '../helpers/eventReporter.js'
import EventNamesEnum from '../constants/EventNamesEnum.js'

import logger from '../helpers/logger.js'

const handler = function (req, res) {
  let { Models, conn } = req.mongo
  let cardId = req.params.cardId
  let authUserDoc = null

  return Promise.resolve().then(async () => {
      return helpers.authReq(req, Models)
    })
    .then(({ authUser }) => {
      authUserDoc = authUser
    })
    .then(async () => {
      // Check if card is the default card
      return Models.User.findOne({ _id: authUserDoc._id }).lean()
    })
    .then((user) => {
      if (user && user.defaultCardId && user.defaultCardId.toString() === cardId) {
        throw new Error('Cannot delete defaultCard')
      }
    })
    .then(() => {
      // Delete the card
      return Models.Card.findOneAndDelete({ _id: cardId, userId: authUserDoc._id }).lean()
    })
    .then((removedCard) => {
      if (!removedCard) {
        throw new Error('Card not found')
      }

      // Report event
      return EventReporter.storeInfoEvent(EventNamesEnum.CARD_DELETED, {
        userId: removedCard.userId,
        card: removedCard
      })
        .then(() => {
          return removedCard
        })
    })
    .then((removedCard) => {
      // Remove card from user's cards array
      return Models.User.findOneAndUpdate(
        { _id: authUserDoc._id },
        { $pull: { cards: cardId } }
      )
        .then(() => {
          // Get updated list of cards
          return Models.Card.find({ userId: authUserDoc._id }).lean()
        })
    })
    .then((cards) => {
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
        cards: cards
      }))
    })
    .catch((error) => {
      logger.error(error, { eventName: 'DELETE_CARD_FAILED' })

      if (error.resultResponse) {
        res.set(error.resultResponse.headers)
        res.status(error.resultResponse.statusCode)
        res.send(error.resultResponse.body || '')
        return
      }

      const isClientError = error.message === 'Cannot delete defaultCard'
        || error.message === 'Card not found'

      res.status(
        isClientError
          ? ResponseCodes['400_BAD_REQUEST']
          : ResponseCodes['500_INTERNAL_SERVER_ERROR']
      ).json({
        message: 'Something wrong happened',
        error: true,
        errorMessage: error.message,
      })
    })
}

export default  handler
