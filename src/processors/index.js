import processStoryDemo from './processStoryDemo.js'
import processStoryDemoDom from './processStoryDemoDom.js'
import processSandboxDom from './processSandboxDom.js'
import processStoryDemoVideo from './processStoryDemoVideo.js'
import processAutoRecording from './processAutoRecording.js'
import processDemoActivityEvents from './processDemoActivityEvents.js'
import processAgentKnowledge from './processAgentKnowledge.js'
import processAgentSession from './processAgentSession.js'

const configsArr = [
  // publishLiveDemo
  processStoryDemo,
  processStoryDemoDom,
  processSandboxDom,
  processAutoRecording,
  processDemoActivityEvents,
  processAgentKnowledge,
  processAgentSession
]


const videoConfigsArr = [
  processStoryDemoVideo,
]

// Video jobs (record + ffmpeg enhance/mix + gif) can exceed monq's 5 min default watchdog
const MONQ_JOB_CALLBACK_WATCHDOG_TIMEOUT = Number(process.env.MONQ_JOB_CALLBACK_WATCHDOG_TIMEOUT) || 1800000 // 30 minutes

export default (sharedConfig) => {
  return {
    allQueueNames: configsArr
      .reduce((accum, config) => {
        accum = accum.concat(config.queueNames)
        return accum
      }, [])
      .filter(function (value, index, self) {

        return self.indexOf(value) === index
      }),
    workerConfig: {
      collection: 'jobs-monq',
      jobCallbackWatchdogTimeout: MONQ_JOB_CALLBACK_WATCHDOG_TIMEOUT,
      callbacks: configsArr.reduce((accum, config) => {
        config.jobNames.forEach(jobName => {
          accum[jobName] = (params, callback) => {
            return config.handler(sharedConfig, params, callback)
          }
        })

        return accum
      }, {})
    },
    videoQueueNames: videoConfigsArr
      .reduce((accum, config) => {
        accum = accum.concat(config.queueNames)
        return accum
      }, [])
      .filter(function (value, index, self) {

        return self.indexOf(value) === index
      }),
    videoWorkerConfig: {
      collection: 'jobs-monq',
      jobCallbackWatchdogTimeout: MONQ_JOB_CALLBACK_WATCHDOG_TIMEOUT,
      callbacks: videoConfigsArr.reduce((accum, config) => {
        config.jobNames.forEach(jobName => {
          accum[jobName] = (params, callback) => {
            return config.handler(sharedConfig, params, callback)
          }
        })

        return accum
      }, {})
    }
  }
}
