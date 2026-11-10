import Joi from '@hapi/joi'

function validateBody(body) {
    const schema = Joi.object().keys({
        name: Joi.string().trim().max(200).allow(''),
    })

    const result = schema.validate(body)

    return result
}

export default validateBody
