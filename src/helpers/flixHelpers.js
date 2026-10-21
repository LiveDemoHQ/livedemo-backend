import moment from 'moment'

import fsp from 'fs/promises'
import axios from 'axios'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import ENV from '../envServer.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import RenderEventTypes from '../constants/RenderEventTypes.js'
import helpers from '../helpers.js'
import { pipeline, Readable } from 'stream'
import short from 'short-uuid'
import monq from 'monq'
import Mux from '@mux/mux-node'
import he from 'he'

const mux = new Mux({
  tokenId: ENV.MUX_TOKEN_ID,
  tokenSecret: ENV.MUX_TOKEN_SECRET
})

function waitUntilAssetRenditionsAreReady(assetId, pollTime, count) {

  return new Promise((resolve, reject) => {
    let promiseChain = Promise.resolve()

    for (let i = 0; i < count; i++) {
      promiseChain = promiseChain.then(() => {

        return mux.video.assets.retrieve(assetId)
          .then((assetInfo) => {

            if (assetInfo.static_renditions && assetInfo.static_renditions.status === 'ready') {

              let err = new Error('successful')
              err.assetInfo = assetInfo
              throw err

            } else {

              return new Promise((checkResolve, checkReject) => {
                setTimeout(function () {
                  checkResolve()
                }, pollTime)
              })
            }

          })
      })
    }

    promiseChain = promiseChain.catch((err) => {
      if (err.assetInfo) {

        resolve(err.assetInfo)
      } else {

        reject('waitUntilAssetIsReady has timed-out')
      }
    })

  })
}

function waitUntilAssetIsReady(assetId, pollTime, count) {

  return new Promise((resolve, reject) => {
    let promiseChain = Promise.resolve()

    for (let i = 0; i < count; i++) {
      promiseChain = promiseChain.then(() => {

        return mux.video.assets.retrieve(assetId)
          .then((assetInfo) => {

            if (assetInfo.status !== 'ready') {

              return new Promise((checkResolve, checkReject) => {
                setTimeout(function () {
                  checkResolve()
                }, pollTime)
              })
            } else {

              let err = new Error('successful')
              err.assetInfo = assetInfo
              throw err

            }

          })
      })
    }

    promiseChain = promiseChain.then(() => {
      reject('waitUntilAssetIsReady has timed-out')
    })


    promiseChain = promiseChain.catch((err) => {
      if (err.assetInfo) {

        resolve(err.assetInfo)
      } else {

        reject('waitUntilAssetIsReady has timed-out')
      }
    })

  })
}

function waitUntilAssetIsUploaded(uploadId, pollTime, count) {
  return new Promise((resolve, reject) => {
    let promiseChain = Promise.resolve()

    for (let i = 0; i < count; i++) {
      promiseChain = promiseChain.then(() => {

        return mux.video.uploads.retrieve(uploadId)
          .then((assetInfo) => {

            if (assetInfo.status !== 'asset_created') {

              return new Promise((checkResolve, checkReject) => {
                setTimeout(function () {
                  checkResolve()
                }, pollTime)
              })
            } else {

              let err = new Error('successful')
              err.assetInfo = assetInfo
              throw err

            }

          })
      })
    }

    promiseChain = promiseChain.catch((err) => {
      if (err.assetInfo) {

        resolve(err.assetInfo)
      } else {

        reject('waitUntilAssetIsUploaded has timed-out')
      }
    })

  })
}



function createMuxClips(videoAssetId, renderEvents) {
  let videoEvents = renderEvents.filter(event => event.type === 'video')

  let videoUploads = videoEvents.map((event) => {

    return mux.video.assets.create({
      input: [
        {
          url: `mux://assets/${videoAssetId}`,
          start_time: event.startMillis,
          end_time: event.endMillis
        }
      ],
      playback_policy: ['public'],
      mp4_support: 'standard',
      max_resolution_tier: '2160p',
      normalize_audio: false,
      video_quality: 'plus'
    })
      .then((assetObj) => {

        return waitUntilAssetIsReady(assetObj.id, 5000, 5)
          .then((assetInfo) => {

            assetInfo.videoId = event.videoId
            return assetInfo
          })

      })
  })


  return Promise.all(videoUploads)
}

function saveMuxVideo(filePath, videoData) {
  let videoBuff = videoData
  if (typeof videoBuff === 'string') {

    videoBuff = Buffer.from(videoData.replace(/^data:video\/\w+;base64,/, ''), 'base64')
  }

  return fsp.writeFile(filePath, videoData)
    .then(() => {
      return filePath
    })
}

function uploadMuxVideo(videoData) {
  let videoBuff = videoData
  if (typeof videoBuff === 'string') {

    videoBuff = Buffer.from(videoData.replace(/^data:video\/\w+;base64,/, ''), 'base64')
  }

  return mux.video.uploads.create({
    new_asset_settings: {
      max_resolution_tier: '2160p',
      normalize_audio: false,
      playback_policy: ['public'],
      mp4_support: 'standard',
      video_quality: 'plus'
    },
    cors_origin: '*',
  })
    .then((uploadObj) => {

      return axios.put(uploadObj.url, videoBuff, {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

        .then((uploadResp) => {

          return waitUntilAssetIsUploaded(uploadObj.id, 5000, 5)
            .then(uploadInfo => {

              return waitUntilAssetIsReady(uploadInfo.asset_id, 5000, 15)
                .then((assetInfo) => {
                  assetInfo.assetId = uploadInfo.asset_id

                  return assetInfo
                })
            })
        })
    })
    .then((uploadedAssetInfo) => {

      console.log(uploadedAssetInfo)

      return uploadedAssetInfo
    })
}


function uploadStoryVideo(videoName, buff) {
  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    }
  })

  console.log('AWS_ACCESS_KEY_ID ' + ENV.AWS_ACCESS_KEY_ID)
  console.log('AWS_SECRET_ACCESS_KEY ' + ENV.AWS_SECRET_ACCESS_KEY)

  let uploadParams = {
    Bucket: 'livedemo-cdn',
    Key: 'story-videos/' + videoName + '.mp4',
    Body: buff,
    ACL: 'public-read',
    ContentEncoding: 'base64',
    ContentType: 'video/mp4'
  }

  return new Promise(async (resolve, reject) => {
    try {
      const upload = new Upload({
        client: s3Client,
        params: uploadParams
      })

      const uploadResult = await upload.done()

      console.log('successfully uploaded the story video!')
      resolve(uploadResult)
    } catch (error) {
      console.log(error)
      console.log('Error uploading data: ', error)
      reject(error)
    }
  })
}

function uploadStoryGif(gifName, buff) {
  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    }
  })

  console.log('AWS_ACCESS_KEY_ID ' + ENV.AWS_ACCESS_KEY_ID)
  console.log('AWS_SECRET_ACCESS_KEY ' + ENV.AWS_SECRET_ACCESS_KEY)

  let uploadParams = {
    Bucket: 'livedemo-cdn',
    Key: 'story-gifs/' + gifName + '.gif',
    Body: buff,
    ACL: 'public-read',
    ContentEncoding: 'base64',
    ContentType: 'image/gif'
  }

  return new Promise(async (resolve, reject) => {
    try {
      const upload = new Upload({
        client: s3Client,
        params: uploadParams
      })

      const uploadResult = await upload.done()

      console.log('successfully uploaded the story gif!')
      resolve(uploadResult)
    } catch (error) {
      console.log(error)
      console.log('Error uploading data: ', error)
      reject(error)
    }
  })
}

function uploadStoryVideoFromStream(videoName) {
  const s3Bucket = new AWS.S3({
    accessKeyId: ENV.AWS.ACCESS_KEY_ID,
    secretAccessKey: ENV.AWS.SECRET_ACCESS_KEY,
    params: { Bucket: 'livedemo-cdn' }
  })
  const pass = new stream.PassThrough();

  let data = {
    Key: 'story-videos/' + videoName + '.mp4',
    Body: pass,
    ACL: 'public-read',
    ContentEncoding: 'base64',
    ContentType: 'video/mp4'
  }

  return {
    writeStream: pass,
    promise: new Promise(async (resolve, reject) => {
      let uploadResult = null
      try {

        uploadResult = await s3Bucket.upload(data).promise()

        console.log('successfully uploaded the story video!')
        resolve(uploadResult)
      } catch (error) {

        console.log(error)
        console.log('Error uploading data: ', uploadResult)
        reject(err)
      }
    })
  }
}

function uploadVideo(videoData, videoName) {
  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    }
  })

  console.log('AWS_ACCESS_KEY_ID ' + ENV.AWS_ACCESS_KEY_ID)
  console.log('AWS_SECRET_ACCESS_KEY ' + ENV.AWS_SECRET_ACCESS_KEY)


  let buf = Buffer.from(videoData.replace(/^data:video\/\w+;base64,/, ''), 'base64')
  let uploadParams = {
    Bucket: 'livedemo-cdn',
    Key: 'flix-videos/' + videoName + '.webm',
    Body: buf,
    ACL: 'public-read',
    ContentEncoding: 'base64',
    ContentType: 'video/webm'
  }

  return new Promise(async (resolve, reject) => {
    try {
      const upload = new Upload({
        client: s3Client,
        params: uploadParams
      })

      const uploadResult = await upload.done()

      console.log('successfully uploaded the video!')
      resolve(uploadResult)
    } catch (error) {
      console.log(error)
      console.log('Error uploading data: ', error)
      reject(error)
    }
  })

}


function uploadImage(imageData, imageName) {
  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    }
  })

  console.log('AWS_ACCESS_KEY_ID ' + ENV.AWS_ACCESS_KEY_ID)
  console.log('AWS_SECRET_ACCESS_KEY ' + ENV.AWS_SECRET_ACCESS_KEY)


  let buf = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  let uploadParams = {
    Bucket: 'livedemo-cdn',
    Key: 'flix-images/' + imageName + '.png',
    Body: buf,
    ACL: 'public-read',
    ContentEncoding: 'base64',
    ContentType: 'image/png'
  }

  return new Promise(async (resolve, reject) => {
    try {
      const upload = new Upload({
        client: s3Client,
        params: uploadParams
      })

      const uploadResult = await upload.done()

      console.log('successfully uploaded the image!')
      resolve(uploadResult)
    } catch (error) {
      console.log(error)
      console.log('Error uploading data: ', error)
      reject(error)
    }
  })

}

async function getUserTokenAuth(token) {
  return axios.post(`${ENV.URL}/users/token-authenticate`, {
    token: token
  })
    .then(function (response) {

      return response.data
    })

}


async function authReq(req) {
  let authHeader = req.get('Authorization')
  if (!authHeader) {
    throw new Error('No Authorization header set')
  }

  let token = authHeader.split(' ')[1]
  if (!token) {
    throw new Error('Authorization token not found')
  }

  let authUser = await getUserTokenAuth(token)

  return {
    authUser,
    authToken: token
  }
}


function validateBody(body, validatorFunction) {

  const validationResult = validatorFunction(body)
  if (validationResult.error) {
    const response = {
      statusCode: 500,
      headers: {
        'Access-Control-Max-Age': 600,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
        // Required for CORS support to work
        'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
      },
      body: JSON.stringify({
        error: validationResult.error
      })
    }

    let error = new Error('Invalid body')
    error.resultResponse = response

    throw error
  }

  return validationResult
}

function validateUserHasAccessToWorkspace(userDoc, workspaceId) {


  const foundWkspace = userDoc.workspaces.find(workspace => workspace._id === workspaceId)
  if (!foundWkspace) {
    const resultResponse = {
      statusCode: ResponseCodes['400_BAD_REQUEST'],
      headers: {
        'Access-Control-Max-Age': 600,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
        // Required for CORS support to work
        'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
      }
    }

    let error = new Error('400')
    error.resultResponse = resultResponse

    throw error
  }

}


function getRenderEvents(capturedEvents, videoStartMs, videoEndMs, screenshots) {
  let renderEvents = []

  let startTime = videoStartMs
  let endTime = videoEndMs

  let startMillis = 0
  let videoEndMillis = parseFloat(
    Math.abs(
      moment.duration(moment(startTime).diff(moment(endTime))).asMilliseconds() / 1000.0
    ).toPrecision(4)
  )
  let endMillis = 0

  let clickEvents = capturedEvents.filter(event => {
    return event.type === 'click' && event.timeMs > videoStartMs && event.timeMs < videoEndMs
  })
    .sort((firstEvent, secondEvent) => firstEvent.timeMs - secondEvent.timeMs)


  for (let i = 0; i < clickEvents.length; i++) {
    let event = clickEvents[i]

    endTime = event.timeMs
    endMillis = parseFloat(
      Math.abs(
        moment.duration(moment(event.timeMs).diff(moment(videoStartMs))).asMilliseconds() / 1000.0
      ).toPrecision(4)
    )

    let testTime = event.timeMs - videoStartMs

    if (endTime < startTime && i === 0) {

      endTime = videoStartMs
      endMillis = 0
    } else {

      let videoRenderEvent = {
        startTime: startTime,
        endTime: endTime,
        startMillis,
        endMillis,
        videoId: short.uuid(),
        type: RenderEventTypes.VIDEO
      }

      renderEvents.push(videoRenderEvent)
    }




    let imageRenderEvent = {
      startTime: endTime,
      startMillis: endMillis,
      type: RenderEventTypes.IMAGE,
      imageId: event.clickId,
      frameX: event.frameX,
      frameY: event.frameY,
      description: '',
      image: screenshots[event.clickId],
      targetHTML: event.targetHTML ? he.encode(event.targetHTML) : '',
      targetText: event.targetText,
      targetElementType: event.targetElementType,
    }

    renderEvents.push(imageRenderEvent)

    startTime = endTime
    startMillis = endMillis
  }

  if (startTime < videoEndMs) {
    endTime = videoEndMs

    let videoRenderEvent = {
      startTime: startTime,
      endTime: endTime,
      startMillis,
      endMillis: videoEndMillis,
      videoId: short.uuid(),
      type: RenderEventTypes.VIDEO
    }

    renderEvents.push(videoRenderEvent)

    let imageRenderEvent = {
      startTime: endTime,
      startMillis: videoEndMillis,
      type: RenderEventTypes.IMAGE,
      imageId: 'final',
      image: screenshots['final']
    }

    renderEvents.push(imageRenderEvent)
  }

  renderEvents = renderEvents.filter(event => {
    if (event.type === 'video' && event.endTime - event.startTime < 501) {

      return false
    } else {

      return true
    }
  })

  console.log(renderEvents)
  return renderEvents
}

function buildCursorPositionDocs(storyId, cursorPositionsInput) {
  let input = cursorPositionsInput || []
  return input.map((cp) => ({
    storyId,
    frameX: cp.frameX,
    frameY: cp.frameY,
    timeMs: cp.timeMs
  }))
}

function getCursorPositionIdsForVideoSegment(insertedCursorPositions, startTime, endTime) {
  return insertedCursorPositions
    .filter((doc) => doc.timeMs >= startTime && doc.timeMs < endTime)
    .map((doc) => doc._id)
}

function insertStoryCursorPositions(CursorPositionsModel, cursorPositionDocs) {
  if (cursorPositionDocs.length === 0) {
    return Promise.resolve([])
  }
  return CursorPositionsModel.insertMany(cursorPositionDocs)
}

function enqueueProcessStoryDemo(storyDemoId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('storyDemos', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'processStoryDemo'
    queue.enqueue(jobName, { storyDemoId }, { priority: 1 }, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued:', job.data)
      resolve()
    })

  })
}


function enqueueProcessStoryDemoDom(storyDemoId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('storyDemos', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'processStoryDemoDom'
    queue.enqueue(jobName, { storyDemoId }, { priority: 1 }, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued:', job.data)
      resolve()
    })

  })
}


function enqueueProcessSandboxDom(storyDemoId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('storyDemos', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    queue.enqueue('processSandboxDom', { storyDemoId }, { priority: 1 }, function (err, job) {
      if (err) {
        return reject(err)
      }
      console.log('Enqueued:', job.data)
      resolve()
    })
  })
}

function enqueueProcessAutoRecording(autoRecordingId) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('autoRecordings', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'processAutoRecording'
    queue.enqueue(jobName, { autoRecordingId }, {priority: 1}, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued:', job.data)
      resolve()
    })
  })
}

function enqueueProcessStoryDemoVideo(storyDemoId, userEmail) {
  const client = monq(ENV.DB_URI || 'mongodb://localhost:27017/livedemo_app')
  const queue = client.queue('storyDemos', { collection: 'jobs-monq' })

  return new Promise((resolve, reject) => {
    let jobName = 'processStoryDemoVideo'
    queue.enqueue(jobName, { storyDemoId, userEmail }, function (err, job) {
      if (err) {
        reject(err)
      }
      console.log('Enqueued:', job.data)
      resolve()
    })

  })
}

function uploadImageBuffer(buffer, imageName, contentType = 'image/jpeg', extension = 'jpg') {
  const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    }
  })

  const uploadParams = {
    Bucket: 'livedemo-cdn',
    Key: 'flix-images/' + imageName + '.' + extension,
    Body: buffer,
    ACL: 'public-read',
    ContentType: contentType
  }

  return new Promise(async (resolve, reject) => {
    try {
      const upload = new Upload({
        client: s3Client,
        params: uploadParams
      })

      const uploadResult = await upload.done()

      console.log('successfully uploaded the image buffer!')
      resolve(uploadResult)
    } catch (error) {
      console.log(error)
      console.log('Error uploading image buffer: ', error)
      reject(error)
    }
  })
}

export default {
  authReq,
  getUserTokenAuth,
  validateBody,
  validateUserHasAccessToWorkspace,
  uploadImage,
  uploadImageBuffer,
  uploadVideo,
  uploadStoryGif,
  uploadStoryVideo,
  saveMuxVideo,
  uploadMuxVideo,
  createMuxClips,
  getRenderEvents,
  buildCursorPositionDocs,
  getCursorPositionIdsForVideoSegment,
  insertStoryCursorPositions,
  enqueueProcessStoryDemo,
  enqueueProcessStoryDemoDom,
  enqueueProcessSandboxDom,
  enqueueProcessStoryDemoVideo,
  enqueueProcessAutoRecording

}
