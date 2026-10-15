import fsp from 'fs/promises'
import axios from 'axios'
import { S3Client, PutObjectAclCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import ENV from '../envServer.js'
import {getUserByAccessToken} from './authHelpers.js'
import {pipeline, Readable} from 'stream'
import * as fs from 'fs'
import ResponseCodes from '../constants/ResponseCodes.js'

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

                    console.error('Pipeline failed', err)
                    reject(err)
                } else {

                    console.log('Pipeline succeeded')
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

function writeToSystemFromStream(filePath, contentStream, encoding) {

    return new Promise((resolve, reject) => {

        let writeStream = fs.createWriteStream(filePath, encoding = 'utf8')

        // const readable = Readable.from([content], {
        //   highWaterMark: 0.2 * 1000000
        // })

        // const stringifyStream = stringify(content, {
        //   highWaterMark: 0.2 * 1000000
        // })


        pipeline(
            contentStream,
            writeStream,
            (err) => {

                if (err) {

                    console.error('Pipeline failed', err)
                    reject(err)
                } else {

                    console.log('Pipeline succeeded')
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

function readLiveDemo(path) {

    return Promise.all([
        fsp.readFile(`${path}/manifest.json`),
        fsp.readFile(`${path}/localStorage.json`),
        fsp.readFile(`${path}/firstDoc.json`),
        fsp.readFile(`${path}/cookies.json`)
    ])
        .then(([manifestStr, localStorageStr, firstDocStr, cookiesStr]) => {
            let manifestJson = JSON.parse(manifestStr)
            let firstDocJson = JSON.parse(firstDocStr).firstDoc
            let localStorageJson = JSON.parse(localStorageStr).localStorageMine
            let cookies = JSON.parse(cookiesStr).cookies
            let requests = []

            let resolveFilesChain = Promise.resolve()
            for (let i = 0; i < manifestJson.length; i++) {
                let fileName = manifestJson[i]
                resolveFilesChain = resolveFilesChain
                    .then(() => {

                        return fsp.readFile(`${path}/${fileName}`)
                    })
                    .then(fileStr => {
                        let parsedRequest = JSON.parse(fileStr)

                        requests.push(parsedRequest)
                    })
            }

            return resolveFilesChain
                .then(() => {
                    return {
                        manifestJson,
                        localStorageJson,
                        cookies,
                        firstDocJson,
                        requests
                    }
                })
        })
}


async function saveRequestsToFileSystem(dir, shouldRewriteFiles, requestFileNames, requests) {

    try {


        await fsp.access(`${dir}/manifest.json`)
            .then(() => {

                return fsp.readFile(`${dir}/manifest.json`)
                    .then(fileStr => JSON.parse(fileStr))
            })
            .then((parsedManifest) => {
                let oldFileNamesArr = parsedManifest

                let newFileNames = oldFileNamesArr.concat(requestFileNames)

                newFileNames = newFileNames.filter((fileName, index) => newFileNames.indexOf(fileName) === index)

                return fsp.writeFile(`${dir}/manifest.json`, JSON.stringify(newFileNames, null, 2))
            })
            .catch((err) => {
                console.log('manifest.json created')

                return fsp.writeFile(`${dir}/manifest.json`, JSON.stringify(requestFileNames, null, 2))
            })


    } catch (error) {
        console.error(error)
    }

    let promiseChain = Promise.resolve()

    for (let i = 0; i < requests.length; i++) {
        let req = requests[i]

        promiseChain = promiseChain.then(() => {
            return fsp.writeFile(`${dir}/${req.fileName}`, JSON.stringify(req, null, 2))
        })
    }

    return promiseChain
}


async function saveToFilesystem(dir, shouldRewriteFiles, requestFileNames, requests, localStorage, cookies, firstDoc) {

    try {

        await fsp.access(`${dir}`)
            .then(() => {
                return
            })
            .catch(() => {

                return fsp.mkdir(dir)
            })

        await fsp.access(`${dir}/manifest.json`)
            .then(() => {

                return fsp.readFile(`${dir}/manifest.json`)
                    .then(fileStr => JSON.parse(fileStr))
            })
            .then((parsedManifest) => {
                let oldFileNamesArr = parsedManifest

                let newFileNames = oldFileNamesArr.concat(requestFileNames)

                newFileNames = newFileNames.filter((fileName, index) => newFileNames.indexOf(fileName) === index)

                return fsp.writeFile(`${dir}/manifest.json`, JSON.stringify(newFileNames, null, 2))
            })
            .catch((err) => {
                console.log('does not exist')

                return fsp.writeFile(`${dir}/manifest.json`, JSON.stringify(requestFileNames, null, 2))
            })


        // const localStorage = Base64ToUint8Array(body.localStorage)
        // const localStorageStr = new TextDecoder().decode(localStorage);

        await fsp.writeFile(`${dir}/localStorage.json`, JSON.stringify({localStorage: localStorage}, null, 2))
        await fsp.writeFile(`${dir}/cookies.json`, JSON.stringify({cookies: cookies}, null, 2))

        await fsp.access(`${dir}/firstDoc.json`)
            .then(() => {

                if (shouldRewriteFiles) {
                    return fsp.writeFile(`${dir}/firstDoc.json`, JSON.stringify({firstDoc: firstDoc}, null, 2))
                }

                return
            })
            .catch(() => {

                return fsp.writeFile(`${dir}/firstDoc.json`, JSON.stringify({firstDoc: firstDoc}, null, 2))
            })


    } catch (error) {
        console.error(error)
    }

    let promiseChain = Promise.resolve()

    for (let i = 0; i < requests.length; i++) {
        let req = requests[i]

        promiseChain = promiseChain.then(() => {
            return fsp.writeFile(`${dir}/${req.fileName}`, JSON.stringify(req, null, 2))
        })
    }

    return promiseChain
}


async function getUserTokenAuth(token) {
    return axios.post(`${ENV.URL}/users/token-authenticate`, {
        token: token
    })
        .then(function (response) {

            return response.data
        })

}

async function getUserTokenAuthDB(token, Models) {
    return getUserByAccessToken(token, Models.User, Models.AuthToken)
        .then(userDoc => {

            return userDoc
        })
}


async function authReq(req, Models) {
    let authHeader = req.get('Authorization')

    const resultResponse = {
        statusCode: ResponseCodes['401_UNAUTHORIZED'],
        headers: {
            'Access-Control-Max-Age': 600,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
            // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        }
    }


    if (!authHeader) {
        let error = new Error('No Authorization header set')
        error.resultResponse = resultResponse
        throw error
    }

    let token = authHeader.split(' ')[1]
    if (!token) {
        let error = new Error('Authorization token not found')
        error.resultResponse = resultResponse
        throw error
    }

    let authUser
    try {


        if (Models !== undefined) {

            authUser = await getUserTokenAuthDB(token, Models)
        } else {

            authUser = await getUserTokenAuth(token)
        }
    } catch (e) {
        let error = new Error(e.message || 'Authorization token not found')
        error.resultResponse = resultResponse
        throw error
    }

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
            statusCode: ResponseCodes['401_UNAUTHORIZED'],
            headers: {
                'Access-Control-Max-Age': 600,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                // Required for CORS support to work
                'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
            }
        }

        let error = new Error('401')
        error.resultResponse = resultResponse

        throw error
    }

    return true
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
        Key: 'story-images/' + imageName,
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


function uploadBufferImage(imageBuff, mimeType, imageName) {
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
        Key: 'story-images/' + imageName,
        Body: imageBuff,
        ACL: 'public-read',
        ContentType: mimeType
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


function uploadBufferBackgroundAudio(audioBuff, mimeType, audioName) {
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
        Key: 'story-background-audios/' + audioName,
        Body: audioBuff,
        ACL: 'public-read',
        ContentType: mimeType
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


function uploadScreenImage(imageBuff, mimeType, imageName) {
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
        Key: 'screen-images/' + imageName,
        Body: imageBuff,
        ACL: 'public-read',
        ContentType: mimeType
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

function uploadScreenVideo(videoBuff, mimeType, videoName) {
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
        Key: 'screen-videos/' + videoName,
        Body: videoBuff,
        ACL: 'public-read',
        ContentType: mimeType
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


// For files written to livedemo-cdn by something else (e.g. LiveKit egress), which can't set an ACL
function makeCdnObjectPublic(key) {
    const s3Client = new S3Client({
        region: 'us-east-1',
        credentials: {
            accessKeyId: ENV.AWS_ACCESS_KEY_ID,
            secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
        }
    })
    return s3Client.send(new PutObjectAclCommand({ Bucket: 'livedemo-cdn', Key: key, ACL: 'public-read' }))
}

function uploadStepAudio(audioBuff, mimeType, audioName) {
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
        Key: 'step-audios/' + audioName,
        Body: audioBuff,
        ACL: 'public-read',
        ContentType: mimeType
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

function findNodeByNodeName(nodeName, nodes) {
    let flatChildNodes = nodes.reduce((accum, node) => {
        if (node.childNodes) {
            accum = accum.concat(node.childNodes)
        }

        return accum
    }, [])


    for (let i = 0; i < flatChildNodes.length; i++) {
        let currentNode = flatChildNodes[i]

        let foundNode = currentNode.nodeName === nodeName

        if (foundNode) {

            return currentNode
        }
    }

    return findNodeByNodeName(nodeName, flatChildNodes)
}

function findNodeByTagValue(searchAttr, searchAttrValue, nodes) {

    let flatChildNodes = nodes.reduce((accum, node) => {
        if (node.childNodes) {
            accum = accum.concat(node.childNodes)
        }

        return accum
    }, [])


    for (let i = 0; i < flatChildNodes.length; i++) {
        let currentNode = flatChildNodes[i]

        if (currentNode.attrs) {

            for (let j = 0; j < currentNode.attrs.length; j++) {
                let currentAttr = currentNode.attrs[j]
                let foundAttr = currentAttr.name === searchAttr && currentAttr.value === searchAttrValue

                if (foundAttr) {

                    return currentNode
                }
            }
        }
    }

    return findNodeByTagValue(searchAttr, searchAttrValue, flatChildNodes)
}


function mapIpWhoOrgResponse(payload) {
    const data = payload?.data
    const geo = data?.geoLocation || {}
    const tz = data?.timezone || {}
    const flag = data?.flag || {}
    const countryCode = geo.countryCode || ''

    // Keep same shape as legacy ipwho.is so session/auto-recording writers stay unchanged.
    return {
        ip: data?.ip,
        continent: geo.continent,
        continent_code: geo.continentCode,
        country: geo.country,
        country_code: countryCode,
        region: geo.region,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        is_eu: geo.is_in_eu,
        postal: geo.postal_Code,
        calling_code: typeof geo.dial_code === 'string'
            ? geo.dial_code.replace(/^\+/, '')
            : geo.dial_code,
        flag: {
            img: flag.flag_Icon
                || (countryCode
                    ? `https://flagcdn.com/${countryCode.toLowerCase()}.svg`
                    : undefined),
            emoji: flag.flag_Icon,
            emoji_unicode: flag.flag_unicode,
        },
        timezone: {
            id: tz.time_zone,
            abbr: tz.abbr,
            is_dst: tz.is_dst,
            offset: tz.offset,
            utc: tz.utc,
            current_time: tz.current_time,
        },
    }
}

function getClientIpData(clientIp) {
    return axios.get(`https://api.ipwho.org/ip/${clientIp}`, {
        params: {
            apiKey: ENV.IPWHO_API_KEY,
        },
    })
        .then((res) => {
            if (!res.data?.success || !res.data?.data) {
                throw new Error(`ipwho.org lookup failed for ${clientIp}`)
            }

            return mapIpWhoOrgResponse(res.data)
        })
}

function validateStoryId(urlParam) {
    if (!urlParam) {
        let newError = new Error('')
        newError.resultResponse = {
            statusCode: ResponseCodes['400_BAD_REQUEST'],
            headers: {
                'Access-Control-Max-Age': 600,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                // Required for CORS support to work
                'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
            },
            body: JSON.stringify({
                message: 'Invalid storyId in url param'
            })
        }

        throw newError
    }


    let storyIdFromUrlParam = ''

    let splitArr = urlParam.split('/')


    if (splitArr[0] + "//" + splitArr[2] === ENV.STORIES_API && !!splitArr[6]) {
        storyIdFromUrlParam = splitArr[6]
    }

    if (!storyIdFromUrlParam) {
        let newError = new Error('')
        newError.resultResponse = {
            statusCode: ResponseCodes['400_BAD_REQUEST'],
            headers: {
                'Access-Control-Max-Age': 600,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept', // Required for CORS support to work
                // Required for CORS support to work
                'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
            },
            body: JSON.stringify({
                message: 'Invalid storyId in url param'
            })
        }

        throw newError
    }

    return Promise.resolve(storyIdFromUrlParam)
}

async function executePromisesInBatches(promiseCreators, batchSize) {
    const results = [];

    for (let i = 0; i < promiseCreators.length; i += batchSize) {
        const batch = promiseCreators.slice(i, i + batchSize);

        const promises = batch.map(creator => creator());

        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
    }
    return results
}

function replaceLinkVarsInText(text, link) {
    if (typeof text !== 'string') return text
    let result = text;

    link.variables.forEach(variable => {
        const pattern = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g');
        result = result.replace(pattern, variable.value);
    });

    return result;
}

function processLiveDemoLinkUpdates(liveDemo, link) {


    liveDemo.screens = liveDemo.screens.map(screen => {
        if(!screen.steps) {
            screen.steps = []
        }

        screen.steps = screen.steps.map(step => {
            if (step && step.view) {
                step.view.content = replaceLinkVarsInText(step.view.content, link)
                if (step.view.popup) {
                    step.view.popup.title = replaceLinkVarsInText(step.view.popup.title, link)
                    step.view.popup.description = replaceLinkVarsInText(step.view.popup.description, link)
                }

            }

            return step
        })

        return screen
    })

    return liveDemo
}


function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshHubspotToken(hubspotToken, Models) {
    if (!hubspotToken || !hubspotToken.refreshToken) {
        throw new Error('HubSpot refresh token not available')
    }

    const HubspotCreds = ENV.OAUTH2Credentials?.HubSpot
    if (!HubspotCreds) {
        throw new Error('HubSpot OAuth not configured')
    }

    const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: HubspotCreds.client_id,
        client_secret: HubspotCreds.client_secret,
        refresh_token: hubspotToken.refreshToken
    }), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })

    const tokenRes = tokenResponse.data

    if (!tokenRes.access_token) {
        throw new Error('Failed to refresh access token from HubSpot')
    }

    // Calculate new expiration time
    const expiresAt = new Date(Date.now() + (tokenRes.expires_in * 1000))

    // Prepare updated token data
    const updatedTokenData = {
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token || hubspotToken.refreshToken,
        expiresAt: expiresAt
    }

    // Update the token in the database
    await Models.HubspotToken.findOneAndUpdate(
        { _id: hubspotToken._id },
        updatedTokenData
    )

    console.log('HubSpot token refreshed successfully for token ID:', hubspotToken._id)

    return {
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token || hubspotToken.refreshToken,
        expiresAt: expiresAt
    }
}

export default {
    readLiveDemo,
    saveToFilesystem,
    saveRequestsToFileSystem,
    validateUserHasAccessToWorkspace,
    validateBody,
    authReq,
    getUserTokenAuth,
    writeToSystem,
    writeToSystemFromStream,
    uploadImage,
    findNodeByNodeName,
    findNodeByTagValue,
    uploadBufferImage,
    uploadBufferBackgroundAudio,
    uploadScreenImage,
    uploadScreenVideo,
    makeCdnObjectPublic,
    uploadStepAudio,
    getClientIpData,
    validateStoryId,
    executePromisesInBatches,
    replaceLinkVarsInText,
    processLiveDemoLinkUpdates,
    sleep,
    refreshHubspotToken
}
