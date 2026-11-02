import Joi from '@hapi/joi'

// Google may post its own form fields (g_csrf_token, select_by): those are ignored
function validateBody(body) {
  const schema = Joi.object().keys({
    credential: Joi.string().required(),
    browserSessionId: Joi.string().max(200).allow('', null),
  }).unknown(true)

  const result = schema.validate(body)

  return result
}

export default validateBody
