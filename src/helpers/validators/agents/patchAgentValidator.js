import Joi from '@hapi/joi'
import validator from 'validator'

const mongoId = Joi.string().custom((id) => {
  if (validator.isMongoId(String(id))) {
    return id
  }
  throw new Error('incorrect id')
})

function validateBody(body) {
  const schema = Joi.object().keys({
    name: Joi.string().max(200).allow(''),
    welcomeMessage: Joi.string().max(2000).allow(''),
    starterQuestions: Joi.array().items(Joi.string().max(500).allow('')).max(20),
    systemPrompt: Joi.string().max(20000).allow(''),
    avatarUrl: Joi.string().max(2000).allow(''),
    voiceEnabled: Joi.boolean(),
    voiceId: Joi.string().max(200).allow(''),
    avatarsEnabled: Joi.boolean(),
    avatarVoice: Joi.string().valid('elevenlabs', 'anam'),
    anamAvatarId: Joi.string().max(200).allow('', null),
    anamVoiceId: Joi.string().max(200).allow('', null),
    avatarProvider: Joi.string().valid('anam', 'lemonslice'),
    lemonsliceAvatarId: Joi.string().max(200).allow('', null),
    theme: Joi.string().valid('light', 'dark', 'dark-blur', 'light-blur'),
    visitorCapture: Joi.object().keys({
      enabled: Joi.boolean(),
      requireName: Joi.boolean(),
      requireEmail: Joi.boolean(),
    }),
    cta: Joi.object().keys({
      bookMeetingUrl: Joi.string().max(2000).allow(''),
      startTrialUrl: Joi.string().max(2000).allow(''),
      inlineCalendar: Joi.boolean(),
    }),
    allowedDemoIds: Joi.array().items(mongoId),
    defaultDemoId: mongoId.allow('', null),
    // Deep shape is checked by their normalizers (goalFlows / qualification / embed / summaryEmail)
    goal: Joi.object().unknown(true),
    qualification: Joi.object().unknown(true),
    embed: Joi.object().unknown(true),
    summaryEmail: Joi.object().keys({
      enabled: Joi.boolean(),
      subject: Joi.string().max(500).allow(''),
      body: Joi.string().max(20000).allow(''),
    }),
    summaryIdleMinutes: Joi.number(),
    recapEnabled: Joi.boolean(),
  })

  const result = schema.validate(body)

  return result
}

export default validateBody
