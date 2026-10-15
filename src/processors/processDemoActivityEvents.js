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

function processVisitEvent(sharedConfig, storyDoc, data) {
    const { Models, axios } = sharedConfig
    console.log('processVisitEvent - Done')
    return Promise.resolve()
}

function processCompletionEvent(sharedConfig, storyDoc, data) {
    const { Models, axios } = sharedConfig
    console.log('processCompletionEvent - Done')
    return Promise.resolve()

}

function processLeadCollectionEvent(sharedConfig, storyDoc, data) {
    const { Models } = sharedConfig
    const { workspaceId, leadData } = data
    const email = leadData?.email

    if (!email) {
        console.log('No email found in lead data, skipping HubSpot contact creation')
        return Promise.resolve()
    }

    return getHubspotAccessToken(Models, workspaceId)
        .then((accessToken) => {
            if (!accessToken) {
                console.log(`HubSpot not connected for workspace ${workspaceId}`)
                return
            }

            return upsertHubspotContact(accessToken, { email, name: leadData?.name })
                .then(contactId => console.log(`HubSpot contact ready: ${contactId}`))
        })
        // Don't fail the job on HubSpot errors
        .catch(error => console.error('Error creating HubSpot contact:', error.response?.data || error.message))
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
            console.log('processDemoActivityEvents failed - end')
            console.log(err)

            callback(err)
        })
}


const config = {
    queueNames: ['demoActivityEvents'],
    jobNames: ['visit-event', 'completion-event', 'lead-collection-event'],
    handler: processDemoActivityEvents
}

export default config
