import Joi from '@hapi/joi'

function validateBody(body) {
  const schema = Joi.object().keys({
    name: Joi.string().max(500).allow(''),
    layout: Joi.string().valid('gallery', 'playlist'),
    // Group fields, sections, facets and items are checked by normalizeShowcase
    header: Joi.object().unknown(true),
    theme: Joi.object().unknown(true),
    seo: Joi.object().unknown(true),
    gallery: Joi.object().unknown(true),
    playlist: Joi.object().unknown(true),
    cta: Joi.object().unknown(true),
    embed: Joi.object().unknown(true),
    sections: Joi.array(),
    facets: Joi.array(),
    items: Joi.array(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
