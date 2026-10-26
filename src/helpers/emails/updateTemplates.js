import Templates from './templates/index.js'


import { SESClient, UpdateTemplateCommand } from '@aws-sdk/client-ses'
import ENV from '../../envServer.js'
import logger from '../logger.js'

const AWS_VARS = ENV.AWS

const sesClient = new SESClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: ENV.SES_ACCESS_KEY_ID,
    secretAccessKey: ENV.SES_SECRET_ACCESS_KEY
  }
})

function updateTemplates() {

  let templateNames = Object.keys(Templates)
  for (let i = 0; i < templateNames.length; i++) {
    let template = Templates[templateNames[i]]

    const command = new UpdateTemplateCommand({
      Template: template.data
    })

    sesClient.send(command).then(
      (data) => logger.info(data, { eventName: 'UPDATE_TEMPLATES' })
    ).catch(
      (err) => logger.error(err, { eventName: 'UPDATE_TEMPLATES_FAILED', err: err.stack })
    )

  }
}

function updateTemplate(template) {

  return new Promise(async (resolve, reject) => {
    try {
      const command = new UpdateTemplateCommand({
        Template: template.data
      })

      const data = await sesClient.send(command)
      logger.info(data, { eventName: 'UPDATE_TEMPLATES' })
      resolve(data)
    } catch (err) {
      logger.error(err, { eventName: 'UPDATE_TEMPLATES_FAILED', err: err.stack })
      reject(err)
    }
  })

}

updateTemplate(Templates.newAutoGenAccountCreated)
updateTemplate(Templates.storyDemoContentCreated)
// updateTemplate(Templates.changePassword)
updateTemplate(Templates.userInvite)
// updateTemplate(Templates.workspaceMemberInvite)
// updateTemplate(Templates.workspaceReport)

export default updateTemplate
