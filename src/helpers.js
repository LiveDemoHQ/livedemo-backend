import stringify from 'stream-json-stringify'
import { pipeline } from 'stream'
import * as fs from 'fs'
import { Readable } from "stream"

import logger from './helpers/logger.js'

function writeToSystem(filePath, content, encoding) {

  return new Promise((resolve, reject) => {

    let writeStream = fs.createWriteStream(filePath, encoding = 'utf8')

    const readable = Readable.from([content], {
      highWaterMark: 0.2 * 1000000
    })

    // const stringifyStream = stringify(content, {
    //   highWaterMark: 0.2 * 1000000
    // })


    pipeline(
      readable,
      writeStream,
      (err) => {

        if (err) {

          logger.error('Pipeline failed', { eventName: 'PIPELINE_FAILED', err: err })
          reject(err)
        } else {

          logger.info('Pipeline succeeded', { eventName: 'PIPELINE_SUCCEEDED' })
          resolve(filePath)

        }
      }
    )

    // stringifyStream.on('end', function () {
    //   writeStream.end()
    //   resolve(filePath)
    // })
    //
    // stringifyStream.on('error', function (err) {
    //   reject(err)
    // })
    //
    // writeStream.on('error', function (err) {
    //   reject(err)
    // })
  })

    .then(() => {


      return filePath
    })
}

export default  {
  writeToSystem
}
