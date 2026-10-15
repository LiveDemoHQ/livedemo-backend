import { SESClient, SendTemplatedEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses'
import ENV from '../../envServer.js'

const sesClient = new SESClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: ENV.SES_ACCESS_KEY_ID,
    secretAccessKey: ENV.SES_SECRET_ACCESS_KEY
  }
})

// Full MIME message (custom headers such as List-Unsubscribe). Resolves to the SES MessageId.
export async function sendRawEmail(mime) {
  const data = await sesClient.send(new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(mime, 'utf8') } }))
  return data.MessageId
}

export function sendEmail(emailTemplate, templateProps, toAddresses, Models) {
  let transformedProps = emailTemplate.transformFunction(templateProps)

  return new Promise(async (resolve, reject) => {

    let params = {
      Destination: {
        ToAddresses: toAddresses
      },
      Source: 'support@livedemo.ai',
      Template: emailTemplate.data.TemplateName,
      TemplateData: JSON.stringify(transformedProps)
    }

    console.log('SES_ACCESS_KEY_ID: ' + ENV.SES_ACCESS_KEY_ID)
    console.log('SES_SECRET_ACCESS_KEY: ' + ENV.SES_SECRET_ACCESS_KEY)

    try {
      const command = new SendTemplatedEmailCommand(params)
      const data = await sesClient.send(command)

      console.log(data.MessageId)

      const emailDoc = await new Models.Email({
        type: emailTemplate.data.TemplateName,
        templateData: emailTemplate.data,
        templateProps: transformedProps,
        toAddresses: toAddresses,
        messageId: data.MessageId
      }).save()

      resolve(emailDoc)
    } catch (err) {
      console.error(err, err.stack)
      reject(err)
    }

  })
}

