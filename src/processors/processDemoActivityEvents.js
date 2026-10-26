import fsp from 'fs/promises'
import ENV_VARS from '../envServer.js'
import StoryStatuses from '../constants/StoryStatuses.js'
import ScreenTypes from '../constants/ScreenTypes.js'
import mongoose from 'mongoose'
const { ObjectId } = mongoose.Types
import flixHelpers from '../helpers/flixHelpers.js'
import he from 'he'
import axios from 'axios'
import { getHubspotAccessToken, upsertHubspotContact } from '../helpers/hubspot.js'

import logger from '../helpers/logger.js'

function processVisitEvent(sharedConfig, storyDoc, data) {
    const { Models, axios } = sharedConfig
    logger.info('processVisitEvent - Done', { eventName: 'PROCESSVISITEVENT_DONE' })
    return Promise.resolve()
}

function processCompletionEvent(sharedConfig, storyDoc, data) {
    const { Models, axios } = sharedConfig
    logger.info('processCompletionEvent - Done', { eventName: 'PROCESSCOMPLETIONEVENT_DONE' })
    return Promise.resolve()

}

function processLeadCollectionEvent(sharedConfig, storyDoc, data) {
    const { Models } = sharedConfig
    const { workspaceId, leadData } = data
    const email = leadData?.email

    if (!email) {
        logger.info('No email found in lead data, skipping HubSpot contact creation', { eventName: 'PROCESS_DEMO_ACTIVITY_EVENTS' })
        return Promise.resolve()
    }

    return getHubspotAccessToken(Models, workspaceId)
        .then((accessToken) => {
            if (!accessToken) {
                logger.info(`HubSpot not connected for workspace ${workspaceId}`, { eventName: 'PROCESS_DEMO_ACTIVITY_EVENTS' })
                return
            }

            return upsertHubspotContact(accessToken, { email, name: leadData?.name })
                .then(contactId => logger.info(`HubSpot contact ready: ${contactId}`, { eventName: 'PROCESS_DEMO_ACTIVITY_EVENTS' }))
        })
        // Don't fail the job on HubSpot errors
        .catch(error => logger.error('Error creating HubSpot contact:', { eventName: 'ERROR_CREATING_HUBSPOT_CONTACT_FAILED', data: { detail: error.response?.data || error.message } }))
}

function processDemoActivityEvents(sharedConfig, params, callback) {
    const { Models, axios } = sharedConfig
    const { storyId, sessionId, sessionEventId, eventName, workspaceId, leadId, leadData } = params
    
    // Determine event type from eventName or params structure
    let name = eventName
    if (!name) {
        // Fallback: determine from params structure
        if (leadId || leadData) {
            name = 'lead-collection'
        } else if (sessionEventId) {
            name = 'completion'
        } else if (sessionId) {
            name = 'visit'
        } else {
            return callback(new Error('Unable to determine event type from params'))
        }
    }

    // Get story document (not needed for lead-collection, but kept for consistency)
    return Models.Story.findOne({ _id: storyId })
        .lean()
        .then((storyDoc) => {
            if (!storyDoc) {
                throw new Error(`Story not found: ${storyId}`)
            }

            let data = {
                storyId,
                sessionId,
                sessionEventId,
                workspaceId,
                leadId,
                leadData
            }

            switch (name) {
                case 'visit':
                    return processVisitEvent(sharedConfig, storyDoc, data)
                case 'completion':
                    return processCompletionEvent(sharedConfig, storyDoc, data)
                case 'lead-collection':
                    return processLeadCollectionEvent(sharedConfig, storyDoc, data)
                default:
                    return Promise.reject(new Error(`Invalid event name: ${name}`))
            }
        })
        .then((result) => {
            // console.log('processDemoActivityEvents completed - end')
            callback(null, { storyId, sessionId })
        })
        .catch(err => {
            logger.error('processDemoActivityEvents failed - end', { eventName: 'PROCESSDEMOACTIVITYEVENTS_FAILED_END_FAILED' })
            logger.error(err, { eventName: 'PROCESS_DEMO_ACTIVITY_EVENTS_FAILED' })

            callback(err)
        })
}


const config = {
    queueNames: ['demoActivityEvents'],
    jobNames: ['visit-event', 'completion-event', 'lead-collection-event'],
    handler: processDemoActivityEvents
}

export default config
