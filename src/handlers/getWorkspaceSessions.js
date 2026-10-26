import helpers from '../helpers/livedemoHelpers.js'
import ResponseCodes from '../constants/ResponseCodes.js'
import moment from 'moment'
import mongoose from 'mongoose';
import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types;
const VIEW_TYPES = {
  '48H': '48H',
  '7D': '7D',
  '30D': '30D',
}

const handler = function (req, res) {
  let { Models, conn } = req.mongo

  let workspaceId = req.params.workspaceId
  let viewType = VIEW_TYPES[req.query.viewType]
  
  // Parse pagination parameters
  let limit = parseInt(req.query.limit) || 10
  let page = parseInt(req.query.page) || 1
  
  // Validate pagination parameters
  if (limit < 1) limit = 10
  if (page < 1) page = 1

  let requestBody = null
  let authUserDoc = null

  let subtractDays = viewType === VIEW_TYPES['48H'] ? 2 : (viewType === VIEW_TYPES['7D'] ? 7 : 30)

  let startTimestamp = moment().subtract(subtractDays, 'day').valueOf()
  let endTimestamp = moment().valueOf()



  return Promise.resolve().then(async () => {

    return helpers.authReq(req, Models)
  })
    .then(({ authUser }) => {
      authUserDoc = authUser

      helpers.validateUserHasAccessToWorkspace(authUserDoc, workspaceId)
    })
    .then(async () => {
      // First, use aggregation to group sessions by storyId, get latest timestamp for each,
      // sort by latest timestamp, and get the top N storyIds for current page
      const skip = (page - 1) * limit
      
      // Get total count of unique storyIds for pagination meta
      const totalCountResult = await Models.Session.aggregate([
        {
          $match: {
            workspaceId: new ObjectId(workspaceId),
            startTimestamp: { $gte: startTimestamp, $lte: endTimestamp }, type: { $ne: 'agent' }
          }
        },
        {
          $group: {
            _id: '$storyId'
          }
        },
        {
          $count: 'total'
        }
      ])
      
      const totalItems = totalCountResult.length > 0 ? totalCountResult[0].total : 0
      const totalPages = Math.ceil(totalItems / limit)
      
      // Get the top N storyIds for current page (sorted by latest session timestamp)
      const topStoryIdsResult = await Models.Session.aggregate([
        {
          $match: {
            workspaceId: new ObjectId(workspaceId),
            startTimestamp: { $gte: startTimestamp, $lte: endTimestamp }, type: { $ne: 'agent' }
          }
        },
        {
          $group: {
            _id: '$storyId',
            latestTimestamp: { $max: '$startTimestamp' }
          }
        },
        {
          $sort: { latestTimestamp: -1 }
        },
        {
          $skip: skip
        },
        {
          $limit: limit
        },
        {
          $project: {
            _id: 1
          }
        }
      ])
      
      const paginatedStoryIds = topStoryIdsResult.map(item => item._id)
      
      // Build pagination meta object
      const meta = {
        pagination: {
          currentPage: page,
          itemsPerPage: limit,
          totalItems: totalItems,
          totalPages: totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      }
      
      // Now fetch only sessions for the paginated storyIds
      const sessionDocs = await Models.Session.find(
        { 
          workspaceId: workspaceId, 
          startTimestamp: { $gte: startTimestamp, $lte: endTimestamp }, type: { $ne: 'agent' },
          storyId: { $in: paginatedStoryIds }
        },
        '_id storyId workspaceId startTimestamp endTimestamp eventsClickCount createdAt duration  stepsCount didPlay didComplete dropOffStep clientIpData.ip clientIpData.country clientIpData.city clientIpData.region clientIpData.flag')
        .populate('storyId', 'name')
        .sort({ startTimestamp: -1 })
        .lean()
      
      if (!sessionDocs) {
        throw new Error('Sessions not found')
      }
      
      // Fetch stories for the paginated storyIds
      const storyDocs = await Models.Story.find(
        { _id: { $in: paginatedStoryIds } },
        '_id name workspaceId createdAt updatedAt userId isPublished status'
      ).lean()
      
      return { storyDocs, sessionDocs, meta }
    })
    .then(async ({ storyDocs, sessionDocs, meta }) => {
      // Get all leads counts for all storyDocs in one query
      const storyIds = storyDocs.map(storyDoc => storyDoc._id)
      const leadsAggregation = await Models.Lead.aggregate([
        { $match: { storyId: { $in: storyIds } } },
        { $group: { _id: '$storyId', count: { $sum: 1 } } }
      ])
      
      // Create a lookup map for leads counts
      const leadsCountMap = {}
      leadsAggregation.forEach(item => {
        leadsCountMap[item._id.toString()] = item.count
      })

      // Calculate metrics for each storyDoc
      const storyDocsWithMetricsUnsorted = storyDocs.map((storyDoc) => {
        const storyIdStr = storyDoc._id.toString()

        // Get all sessions for this storyDoc
        const storySessions = sessionDocs.filter(sessionDoc => {
          const sessionStoryId = sessionDoc.storyId?._id?.toString?.() ?? sessionDoc.storyId?.toString?.() ?? sessionDoc.storyId
          return sessionStoryId === storyIdStr
        })

        // Calculate Time Spent (total duration of all sessions)
        const timeSpent = storySessions.reduce((total, session) => {
          return total + (session.duration || 0)
        }, 0)

        // Calculate Engagement Rate (average of didPlay values)
        let engagementRate = 0
        if (storySessions.length > 0) {
          const didPlaySum = storySessions.reduce((sum, session) => {
            return sum + (session.didPlay ? 1 : 0)
          }, 0)
          engagementRate = (didPlaySum / storySessions.length) * 100
        }

        // Calculate Completion Rate (average of didComplete values)
        let completionRate = 0
        if (storySessions.length > 0) {
          const didCompleteSum = storySessions.reduce((sum, session) => {
            return sum + (session.didComplete ? 1 : 0)
          }, 0)
          completionRate = (didCompleteSum / storySessions.length) * 100
        }

        // Get the latest startTimestamp for this storyDoc's sessions (or 0 if none)
        const latestStartTimestamp = storySessions.length > 0
          ? storySessions[0].startTimestamp || 0
          : 0

        // Get leads count from the lookup map
        const leadsCount = leadsCountMap[storyIdStr] || 0

        // Views count is the number of sessions for this storyDoc
        const views = storySessions.length

        // Calculate unique users based on unique IP addresses
        const uniqueIps = new Set(
          storySessions
            .map(session => session.clientIpData?.ip)
            .filter(ip => ip) // filter out null/undefined IPs
        )
        const uniqueUsers = uniqueIps.size

        // Calculate topDropOffStep by counting all session dropOffStep values
        let topDropOffStep = null
        if (storySessions.length > 0) {
          const dropOffStepCounts = {}
          
          storySessions.forEach(session => {
            if (session.dropOffStep !== null && session.dropOffStep !== undefined) {
              dropOffStepCounts[session.dropOffStep] = (dropOffStepCounts[session.dropOffStep] || 0) + 1
            }
          })
          
          // Find the dropOffStep with the highest count
          // In case of a tie, take the bigger dropOffStep value
          let maxCount = 0
          for (const [step, count] of Object.entries(dropOffStepCounts)) {
            const stepNum = parseInt(step)
            if (count > maxCount || (count === maxCount && stepNum > topDropOffStep)) {
              maxCount = count
              topDropOffStep = stepNum
            }
          }
        }

        return {
          ...storyDoc,
          timeSpent,
          engagementRate,
          completionRate,
          leads: leadsCount,
          views: views,
          uniqueUsers: uniqueUsers,
          topDropOffStep: topDropOffStep,
          latestStartTimestamp: latestStartTimestamp // for sorting only
        }
      })

      // Order by latest sessionDoc startTimestamp descending
      const storyDocsWithMetrics = storyDocsWithMetricsUnsorted
        .sort((a, b) => (b.latestStartTimestamp || 0) - (a.latestStartTimestamp || 0))
        .map(({ latestStartTimestamp, ...rest }) => rest) // remove helper property


      return { storyDocsWithMetrics, sessionDocs, meta }
    })
    .then(({ storyDocsWithMetrics, sessionDocs, meta }) => {

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
      res.send({ 
        liveDemoDocsWithMetrics: storyDocsWithMetrics, 
        sessions: sessionDocs,
        meta: meta
      })
    })
    .catch((error) => {
      logger.error(error, { eventName: 'GET_WORKSPACE_SESSIONS_FAILED' })

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
