import ENV_VARS from './envServer.js'
const DB_URI = ENV_VARS.DB_URI
import { setupDB, getModels } from './models/index.js'
import axios from 'axios'
import monq from 'monq'
import startAgentSchedulers from './helpers/agent/schedulers.js'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

function writeStream(stream, encoding = "utf8") {

  stream.setEncoding(encoding);

  return new Promise((resolve, reject) => {
    let data = "";

    stream.on("data", chunk => data += chunk);
    stream.on("end", () => resolve(data));
    stream.on("error", error => reject(error));
  });
}


const client = monq(process.env.DB_URI || 'mongodb://localhost:27017/livedemo_app')
async function setupWorkers() {
  const conn = await setupDB()
  const Models = getModels(conn)

  const sharedConfig = {
    Models,
    axios
  }
  const processors = await import('./processors/index.js')
  const processorsConfig = processors.default(sharedConfig)


  const worker = client.worker(processorsConfig.allQueueNames, processorsConfig.workerConfig)
  // An 'error' event without a listener crashes the process; monq reconnects on its own
  worker.on('error', err => console.log('[monq] worker error', err.message))
  worker.start()
  startAgentSchedulers(Models)
  console.log("Story consumer started")
}

export default setupWorkers


