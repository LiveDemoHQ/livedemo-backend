import Joi from '@hapi/joi'

function validateBody(body) {
    const schema = Joi.object().keys({
        url: Joi.string().uri().required(),
        browserSessionId: Joi.string().optional().allow(''),
        demoType: Joi.string().valid('storydemo', 'agent').default('storydemo'),
    })

    return schema.validate(body)
}

export default validateBody
