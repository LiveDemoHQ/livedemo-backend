import fsp from 'fs/promises'
import mongoose from 'mongoose'
import StoryStatuses from '../constants/StoryStatuses.js'
import { segmentRrwebEvents } from '../helpers/domDeltaSegmenter.js'
import { captureStoryPreImage, recordRevision } from '../helpers/storyRevisions.js'
import { planSandboxScreens, anchorFromClick, newSandbox } from '../helpers/sandbox/sandbox.js'
import { pickClickMeta, pickThumbnail, createRrwebScreenDoc } from './processStoryDemoDom.js'

import logger from '../helpers/logger.js'

const { ObjectId } = mongoose.Types

// Sandbox recording -> screens with capture links, pushed as one flow.
// New sandbox: the recording's own story becomes the sandbox.
// "Add flow to…": screens go to sandboxCapture.targetSandboxId, the carrier story is soft-deleted.
async function processSandboxDom(sharedConfig, params, callback) {
    const { Models } = sharedConfig
    const { storyDemoId } = params

    logger.info(`Started - processSandboxDom - ${storyDemoId}`, { eventName: 'PROCESS_SANDBOX_DOM' })

    return Models.Story.findOne({ _id: storyDemoId })
        .lean()
        .then(async (capture) => {
            if (!capture || !capture.filePath) {

                throw new Error(`Sandbox recording not found - ${storyDemoId}`)
            }

            const payload = JSON.parse(await fsp.readFile(capture.filePath, { encoding: 'utf8' }))
            const events = Array.isArray(payload.events) ? payload.events : []
            const clickThumbnails = Array.isArray(payload.clickThumbnails) ? payload.clickThumbnails : []
            const viewport = {
                width: (payload.viewport && payload.viewport.width) || (capture.windowMeasures && capture.windowMeasures.innerWidth) || 0,
                height: (payload.viewport && payload.viewport.height) || (capture.windowMeasures && capture.windowMeasures.innerHeight) || 0
            }

            const targetId = capture.sandboxCapture && capture.sandboxCapture.targetSandboxId
            const target = targetId
                ? await Models.Story.findOne({ _id: targetId, workspaceId: capture.workspaceId, mode: 'sandbox', deletedAt: null }).lean()
                : capture
            if (!target) {

                throw new Error(`Target sandbox not found - ${targetId}`)
            }

            const plan = planSandboxScreens(segmentRrwebEvents(events, clickThumbnails))
            if (!plan.length) {

                throw new Error('Sandbox recording produced no screens')
            }

            const preImage = targetId
                ? await captureStoryPreImage(Models, { storyId: String(targetId), workspaceId: String(target.workspaceId) })
                : null
            const last = targetId
                ? await Models.Screen.findOne({ storyId: targetId }).sort({ index: -1 }).select('index').lean()
                : null
            const firstIndex = last ? (last.index || 0) + 1 : 0

            const docs = []
            for (let i = 0; i < plan.length; i++) {
                const entry = plan[i]
                const thumbTs = entry.outClick && entry.outClick.clickTimestamp != null ? entry.outClick.clickTimestamp : entry.toTimeMs
                docs.push(await createRrwebScreenDoc({
                    Models,
                    storyDoc: target,
                    authUserId: capture.userId,
                    name: entry.name,
                    recordingRole: entry.role,
                    baseScreenId: entry.role === 'delta' ? docs[entry.baseIndex]._id : undefined,
                    events: entry.events,
                    fromTimeMs: entry.fromTimeMs,
                    toTimeMs: entry.toTimeMs,
                    width: viewport.width,
                    height: viewport.height,
                    imageData: pickThumbnail(clickThumbnails, thumbTs),
                    index: firstIndex + i,
                    steps: []
                }))
            }

            plan.forEach((entry, i) => {
                docs[i].sandboxLinks = entry.linkTo === null || !docs[entry.linkTo] ? [] : [{
                    gotoType: 'screen',
                    gotoScreen: docs[entry.linkTo]._id,
                    anchor: anchorFromClick(entry.outClick, pickClickMeta(clickThumbnails, entry.outClick.clickTimestamp), viewport),
                    source: 'capture'
                }]
                if (entry.hidden) {

                    docs[i].sandboxHidden = true
                }
            })

            const saved = await Models.Screen_Page.insertMany(docs)
            const ids = saved.map(screen => screen._id)
            const visible = saved.filter(screen => !screen.sandboxHidden)
            const flow = {
                _id: new ObjectId(),
                name: (capture.sandboxCapture && capture.sandboxCapture.flowName) || capture.name || 'Flow',
                startScreenId: visible[0]._id,
                screenIds: visible.map(screen => screen._id),
                // Reaching the end of the recorded path completes the flow (Showcase checklist / autoplay)
                completion: { type: 'screen', screenIds: [visible[visible.length - 1]._id] },
                recordingFilePath: capture.filePath
            }

            if (targetId) {

                await Models.Story.updateOne({ _id: targetId }, { $push: { screens: { $each: ids }, 'sandbox.flows': flow } })
                await Models.Story.updateOne({ _id: capture._id }, { $set: { status: StoryStatuses.READY, deletedAt: new Date() } })
                if (preImage) await recordRevision(Models, { ...preImage, actionLabel: 'sandbox:addFlow' })
            } else {

                const stale = Array.isArray(capture.screens) ? capture.screens : []
                if (stale.length) await Models.Screen.deleteMany({ _id: { $in: stale } })
                await Models.Story.updateOne({ _id: capture._id }, {
                    $set: {
                        screens: ids,
                        status: StoryStatuses.READY,
                        mode: 'sandbox',
                        sandbox: newSandbox({ startScreenId: flow.startScreenId, flows: [flow] }),
                        thumbnailImageUrl: visible[0].imageUrl || capture.thumbnailImageUrl || ''
                    }
                })
            }

            await Models.Workspace.updateOne({ _id: capture.workspaceId }, { $addToSet: { 'library.pages': { $each: ids } } })

            logger.info(`Finished - processSandboxDom - ${storyDemoId} screens=${ids.length} target=${targetId || storyDemoId}`, { eventName: 'PROCESS_SANDBOX_DOM' })
            callback(null, { storyDemoId, sandboxId: String(targetId || storyDemoId), screenCount: ids.length })
        })
        .catch((err) => {
            logger.error(`Failed - processSandboxDom - ${storyDemoId}`, { eventName: 'PROCESS_SANDBOX_DOM_FAILED', err: err })
            return Models.Story.updateOne({ _id: storyDemoId }, { $set: { status: StoryStatuses.FAILED } })
                .catch(() => null)
                .then(() => callback(err))
        })
}

const config = {
    queueNames: ['storyDemos'],
    jobNames: ['processSandboxDom'],
    handler: processSandboxDom
}

export default config
