import assert from 'assert'
import {

  FOUNDING_PROMO_CODE,
  FOUNDING_PROMO_MAX_DEFAULT,
  getFoundingPromoStatus,
  __resetFoundingPromoCacheForTests
} from './foundingPromo.js'
import logger from './logger.js'

async function run() {

  __resetFoundingPromoCacheForTests()

  const Models = {
    Config: {
      findOne: () => ({
        lean: async () => ({
          foundingPromoRedeemed: 2,
          foundingPromoMax: 5
        })
      }),
      findOneAndUpdate: async () => ({})
    }
  }

  // No STRIPE key in this check → falls through to mongo
  const status = await getFoundingPromoStatus(Models)
  assert.strictEqual(status.code, FOUNDING_PROMO_CODE)
  assert.strictEqual(status.redeemed, 2)
  assert.strictEqual(status.max, FOUNDING_PROMO_MAX_DEFAULT)
  assert.strictEqual(status.remaining, 3)
  assert.strictEqual(status.source, 'mongo')
  logger.info('foundingPromo.check.js OK', { eventName: 'FOUNDINGPROMO_CHECK_JS_OK' })
}

run().catch((err) => {
  logger.error(err, { eventName: 'FOUNDING_PROMO_FAILED' })
  process.exit(1)
})
