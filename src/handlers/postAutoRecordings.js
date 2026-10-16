import helpers from '../helpers/livedemoHelpers.js'
import flixHelpers from '../helpers/flixHelpers.js'
import postAutoRecordingsValidator
    from '../helpers/validators/workspaces/auto-recordings/postAutoRecordingsValidator.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import ENV from '../envServer.js'
import moment from "moment"
import AutoRecordingStatuses from "../constants/AutoRecordingStatuses.js";
import AutoRecordingTypes from "../constants/AutoRecordingTypes.js";

const handler = function (req, res) {
    let {Models, conn} = req.mongo

    let workspaceId = req.params.workspaceId
    let requestBody = null
    let authUserDoc = null

    let clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] : (ENV.ENV === 'dev' ? '69.200.224.152' : '')
    // Make sure to get the Client IP, because there could be multiple IPs in the x-forwarded-for header
    clientIp = clientIp.split(',')[0]

    return Promise.resolve()
        .then(async () => {

            return helpers.authReq(req, Models)
        })
        .then(({authUser}) => {
            authUserDoc = authUser
            let validatedBody = helpers.validateBody(req.body, postAutoRecordingsValidator)
            requestBody = validatedBody.value

            helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
        })
        .then(() => {
            if (clientIp) {
                return helpers.getClientIpData(clientIp)
            }
        })
        .then((clientIpData) => {

            return new Models.AutoRecording({
                status: AutoRecordingStatuses.recording,
                type: AutoRecordingTypes.exploring,
                aiName: requestBody.aiName,
                windowMeasures: requestBody.windowMeasures,
                workspaceId: workspaceId,
                sessionData: {
                    clientIpData: {
                        ip: clientIpData.ip,
                        continent: clientIpData.continent,
                        continent_code: clientIpData.continent_code,
                        country: clientIpData.country,
                        country_code: clientIpData.country_code,
                        region: clientIpData.region,
                        city: clientIpData.city,
                        latitude: clientIpData.latitude,
                        longitude: clientIpData.longitude,
                        is_eu: clientIpData.is_eu,
                        postal: clientIpData.postal,
                        calling_code: clientIpData.calling_code,
                        flag: clientIpData.flag,
                        timezone: clientIpData.timezone,
                    },
                    startTimestamp: moment().valueOf(),
                }
            }).save()
        })
        .then((autoRecordingDoc) => {

            return flixHelpers.enqueueProcessAutoRecording(autoRecordingDoc._id)
                .then(() => {

                    return autoRecordingDoc
                })
        })
        .then((autoRecordingDoc) => {

            const resultResponse = {
                statusCode: ResponseCodes['200_OK'],
                headers: {
                    'Access-Control-Max-Age': 600,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                    // Required for CORS support to work
                    'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                }
            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(JSON.stringify(autoRecordingDoc))
        })
        .catch((error) => {
            console.log(error)

            let resultResponse
            if (error.resultResponse) {

                resultResponse = error.resultResponse
            } else {


                resultResponse = {
                    statusCode: ResponseCodes['500_INTERNAL_SERVER_ERROR'],
                    headers: {
                        'Access-Control-Max-Age': 600,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                        // Required for CORS support to work
                        'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
                    },
                    body: ''
                }

            }

            res.set(resultResponse.headers)
            res.status(resultResponse.statusCode)
            res.send(resultResponse.body)
        })
}

export default handler
