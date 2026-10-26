import Joi from '@hapi/joi'

// email required for anonymous landing; optional when the web-app sends a Bearer token
function validateBody(body) {

    const schema = Joi.object().keys({
        email: Joi.string().trim().lowercase().email().max(254).optional(),
        url: Joi.string().trim().uri({ scheme: 'https' }).max(2000).required(),
        browserSessionId: Joi.string().optional().allow('')
    })

    return schema.validate(body)
}

export default validateBody
