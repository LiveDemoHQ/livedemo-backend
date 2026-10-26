import Templates from './templates/index.js'

import { SESClient, CreateTemplateCommand } from '@aws-sdk/client-ses'
import VARS from '../../envServer.js'

import logger from '../logger.js'

const sesClient = new SESClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: VARS.SES_ACCESS_KEY_ID,
    secretAccessKey: VARS.SES_SECRET_ACCESS_KEY
  }
})


// node src/helpers/emails/createTemplates.js migrateDemoReady
let templateNames = process.argv.length > 2 ? process.argv.slice(2) : ['emailVerification']
// let templateNames = Object.keys(Templates)
for (let i = 0; i < templateNames.length; i++) {
  let template = Templates[templateNames[i]]

  const command = new CreateTemplateCommand({
    Template: template.data
  })

  sesClient.send(command).then(
    (data) => logger.info(data, { eventName: 'CREATE_TEMPLATES' })
  ).catch(
    (err) => logger.error(err, { eventName: 'CREATE_TEMPLATES_FAILED', err: err.stack })
  )

}
