import ResponseCodes from '../constants/ResponseCodes.js'
import findPreviewStory from '../helpers/findPreviewStory.js'

const CORS_HEADERS = {
    'Access-Control-Max-Age': 600,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
    'Access-Control-Allow-Credentials': true,
}

const handler = function (req, res) {
    const { Models } = req.mongo
    const { urlDemoId } = req.params
    const { browserSessionId } = req.query

    if (!urlDemoId) {
        res.set(CORS_HEADERS)
        res.status(ResponseCodes['400_BAD_REQUEST'])
        return res.send(JSON.stringify({ error: 'urlDemoId is required' }))
    }

    const POLL_INTERVAL_MS = 1000
    const TIMEOUT_MS = 30000

    const pollUntilCompleted = (startTime) => {
        return Models.UrlDemo.findOne({ _id: urlDemoId, browserSessionId }).lean().then((urlDemo) => {
            if (!urlDemo) {
                res.set(CORS_HEADERS)
                res.status(ResponseCodes['404_NOT_FOUND'])
                res.send(JSON.stringify({ error: 'Not found' }))
                return null
            }

            const elapsed = Date.now() - startTime
            const isCompleted = urlDemo.status === 'completed' && urlDemo.storyId
            const timedOut = elapsed >= TIMEOUT_MS

            if (!isCompleted && !timedOut) {
                return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
                    .then(() => pollUntilCompleted(startTime))
            }

            return urlDemo
        })
    }

    return pollUntilCompleted(Date.now())
        .then((urlDemo) => {
            if (!urlDemo) return

            if (!urlDemo.storyId) {
                res.set(CORS_HEADERS)
                res.status(ResponseCodes['200_OK'])
                return res.send(JSON.stringify(urlDemo))
            }

            return findPreviewStory(Models, urlDemo.storyId).then((storyDoc) => {
                res.set(CORS_HEADERS)
                res.status(ResponseCodes['200_OK'])
                return res.send(JSON.stringify({ ...urlDemo, storyDoc }))
            })
        })
        .catch((error) => {
            console.error('[getUrlDemos]', error)
            res.set(CORS_HEADERS)
            res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR'])
            return res.send(JSON.stringify({ error: 'Internal server error' }))
        })
}

export default handler
