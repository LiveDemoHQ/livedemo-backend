import Joi from '@hapi/joi'

// Posted by the identity provider (SAML 2.0 HTTP-POST binding): other form fields are ignored
function validateBody(body) {
  const schema = Joi.object().keys({
    SAMLResponse: Joi.string().required(),
    RelayState: Joi.string().allow(''),
  }).unknown(true)

  const result = schema.validate(body)

  return result
}

export default validateBody
