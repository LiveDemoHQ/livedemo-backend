import fs from 'fs'
import Templates from './templates/index.js'


import { SESClient, TestRenderTemplateCommand } from '@aws-sdk/client-ses'
import ENV from '../../envServer.js'
import logger from '../logger.js'

const AWS_VARS = ENV.AWS

const sesClient = new SESClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: AWS_VARS.ACCESS_KEY_ID,
    secretAccessKey: AWS_VARS.SECRET_ACCESS_KEY
  }
})

function renderTemplateExamples() {

  let templateNames = Object.keys(Templates)
  for (let i = 0; i < templateNames.length; i++) {
    let template = Templates[templateNames[i]]

    const command = new TestRenderTemplateCommand({
      TemplateData: JSON.stringify(template.exampleProps),
      TemplateName: template.data.TemplateName
    })

    sesClient.send(command).then((data) => {
      fs.writeFile(`./renderedTemplateExamples/${template.data.TemplateName}.eml`, data.RenderedTemplate, 'utf8', function (err, res) {
        if(err){
          logger.info(`Could not save the rendered tempalte - ${template.data.TemplateName}`, { eventName: 'RENDER_TEMPLATE_EXAMPLES' })
        } else {
          logger.info(`Template saved successfully - ${template.data.TemplateName}`, { eventName: 'RENDER_TEMPLATE_EXAMPLES' })
        }
      })
    }).catch((err) => {
      logger.error(err, { eventName: 'RENDER_TEMPLATE_EXAMPLES_FAILED', err: err.stack })
    })

  }
}

function renderTemplateExample(template) {

  return new Promise(async (resolve, reject) => {

    let transformedProps = template.transformFunction(template.exampleProps)

    try {
      const command = new TestRenderTemplateCommand({
        TemplateData: JSON.stringify(transformedProps),
        TemplateName: template.data.TemplateName
      })

      const data = await sesClient.send(command)

      fs.writeFile(`./renderedTemplateExamples/${template.data.TemplateName}.eml`, data.RenderedTemplate, 'utf8', function (err, res) {
        if(err){
          logger.info(`Could not save the rendered tempalte - ${template.data.TemplateName}`, { eventName: 'RENDER_TEMPLATE_EXAMPLES' })
          reject()
        } else {
          logger.info(`Template saved successfully - ${template.data.TemplateName}`, { eventName: 'RENDER_TEMPLATE_EXAMPLES' })
          resolve()
        }
      })
    } catch (err) {
      logger.error(err, { eventName: 'RENDER_TEMPLATE_EXAMPLES_FAILED', err: err.stack })
      reject()
    }
  })


}

export default renderTemplateExample