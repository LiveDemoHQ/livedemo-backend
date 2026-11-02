import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    // multipart (type 'file') sends every field as a string; Joi converts numbers
    type: Joi.string().valid('text', 'faq', 'url', 'site', 'call', 'file').required(),
    title: Joi.string().max(500).allow(''),
    rawText: Joi.string().allow(''),
    faq: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.object().unknown(true))
    ),
    url: Joi.string().max(2000).allow(''),
    refreshHours: Joi.number().allow(null),
    maxPages: Joi.number().allow(null),
    // Pre-chunked import, checked by importedChunks()
    chunks: Joi.array(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
