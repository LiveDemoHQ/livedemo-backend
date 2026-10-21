import Joi from '@hapi/joi'

const id = Joi.string().hex().length(24)
const color = Joi.string().pattern(/^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i).allow(null)
const url = Joi.string().uri({ scheme: ['http', 'https'] }).max(2000).allow('')
const offset = Joi.number().integer().min(0).max(200)

const item = Joi.object({
    _id: id.optional(),
    title: Joi.string().max(80).allow(''),
    description: Joi.string().max(300).allow(''),
    estimatedMinutes: Joi.number().min(0).max(600),
    clickAction: Joi.object({
        type: Joi.string().valid('startDemo', 'openStep', 'url', 'converted').required(),
        storyId: Joi.when('type', { is: Joi.valid('startDemo', 'openStep'), then: id.required(), otherwise: id.allow(null) }),
        stepId: Joi.when('type', { is: 'openStep', then: id.required(), otherwise: id.allow(null) }),
        url: Joi.when('type', { is: 'url', then: url.invalid('').required(), otherwise: url }),
        openInNewTab: Joi.boolean()
    }).required(),
    completion: Joi.when('clickAction.type', { is: 'startDemo', then: Joi.string().valid('demoComplete', 'click', 'none'), otherwise: Joi.string().valid('click', 'none') })
})

const launcher = Joi.object({
    isVisible: Joi.boolean(),
    text: Joi.string().max(30).allow(''),
    icon: Joi.string().valid('checklist', 'rocket', 'sparkles', 'play', 'none', 'custom'),
    iconUrl: url,
    iconPosition: Joi.string().valid('left', 'right'),
    showProgressBadge: Joi.boolean(),
    hideTextWhenOpen: Joi.boolean(),
    backgroundColor: color,
    textColor: color,
    borderColor: color,
    shape: Joi.string().valid('pill', 'rounded', 'square', 'circle'),
    size: Joi.string().valid('sm', 'md', 'lg'),
    shadow: Joi.boolean(),
    pulse: Joi.string().valid('none', 'untilOpened', 'always'),
    corner: Joi.string().valid('bottomRight', 'bottomLeft', 'topRight', 'topLeft'),
    offsetX: offset,
    offsetY: offset
})

// The editor always sends the whole checklist; version is server-owned
function validateBody(body) {

    const schema = Joi.object({
        isActive: Joi.boolean().required(),
        layout: Joi.string().valid('sidebar', 'floating'),
        position: Joi.string().valid('left', 'right'),
        title: Joi.string().max(80).allow(''),
        description: Joi.string().max(300).allow(''),
        logoUrl: url,
        showLogo: Joi.boolean(),
        showProgressBar: Joi.boolean(),
        showEstimatedTime: Joi.boolean(),
        showRemainingCount: Joi.boolean(),
        launchOn: Joi.string().valid('manual', 'demoStart', 'itemComplete'),
        startHidden: Joi.boolean(),
        resetOnLoad: Joi.boolean(),
        confettiOnComplete: Joi.boolean(),
        launcher,
        items: Joi.array().items(item).max(12),
        ctaButtons: Joi.array().items(Joi.object({
            text: Joi.string().max(40).allow(''),
            url: url.invalid('').required(),
            textColor: color,
            backgroundColor: color
        })).max(3),
        theme: Joi.object({
            checkmarkColor: color,
            panelBackgroundColor: color,
            panelTextColor: color
        }),
        version: Joi.any().strip()
    })

    return schema.validate(body)
}

export default validateBody
