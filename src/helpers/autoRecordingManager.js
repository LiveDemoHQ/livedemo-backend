import liveDemoHelpers from '../helpers/livedemoHelpers.js';
import ENV from '../envServer.js';
import { File } from 'node:buffer';

if (typeof globalThis.File === 'undefined') {
    try {
        globalThis.File = File;
    } catch (e) {
        // Fallback for older Node.js versions or when node:buffer.File is unavailable
        // Optionally you can provide a polyfill or a warning
        logger.error('File API is not available. File uploads may fail. Please use Node.js 20 or newer.', { eventName: 'AUTO_RECORDING_MANAGER_FAILED' });
    }
}


import OpenAI from "openai"

import logger from './logger.js'

const model = 'gpt-5.6-terra'

const openai = new OpenAI({
    // apiKey: "sk-",
    apiKey: ENV.OPENAI_API_KEY,
})


async function processAutoRecording(autoRecordingEvents, aiName) {

    await liveDemoHelpers.sleep(12)

    return []
}

/**
 * Uploads a base64-encoded image to OpenAI as a file.
 * Supports png/jpg base64 input. Strips data URL prefix if present.
 * @param {string} base64Image - The base64 image string (may be data URL or plain base64).
 * @param {string} [purpose="user_data"] - Purpose for OpenAI file API.
 * @returns {Promise<Object>} Response from OpenAI API.
 */
async function uploadBase64ImageToOpenAIFile(imageName, base64Image, purpose = "user_data") {

    logger.info(`autoRecordingManager - uploadBase64ImageToOpenAIFile() - started - imageName -> ${imageName}`, { eventName: 'AUTO_RECORDING_MANAGER' })

    // Detect and strip data URL prefix if present
    let matches = base64Image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    let base64;
    let ext = "png"; // Default extension
    let contentType = "image/png"; // Default MIME

    if (matches) {
        // e.g. matches[1] = "image/png", matches[2] = actual base64
        base64 = matches[2];
        contentType = matches[1];
        ext = contentType.split('/')[1] || "png";
    } else {
        // Assume it's just b64 string, still default to png
        base64 = base64Image;
    }

    const buffer = Buffer.from(base64, 'base64');

    // For OpenAI Node v4+, use OpenAI.toFile, which accepts Buffer or stream
    const fileName = `${imageName}.${ext}`;

    let file = await OpenAI.toFile(buffer, fileName);

    try {
        const response = await openai.files.create({
            file: file,
            purpose: purpose,
        });
        logger.info(`autoRecordingManager - uploadBase64ImageToOpenAIFile() - finished - imageName -> ${imageName}`, { eventName: 'AUTO_RECORDING_MANAGER' })

        return response;
    } catch (error) {
        logger.error('Failed to upload base64 image to OpenAI:', { eventName: 'FAILED_TO_UPLOAD_BASE64_IMAGE_TO_OPENAI_FAILED', err: error });
        throw error;
    }
}


class AutoRecordingManager {
    aiName = ''
    windowMeasures = {}
    events = []
    eventsById = {}

    constructor(aiName, windowMeasures) {
        this.aiName = aiName
        this.windowMeasures = windowMeasures

        logger.info(`autoRecordingManager - constructor - aiName -> ${aiName}, windowMeasures -> ${windowMeasures}`, { eventName: 'AUTO_RECORDING_MANAGER' })
    }

    async processEvents(newEvents) {
        if (!newEvents || newEvents.length === 0) {
            return false
        }

        let eventsToAdd = newEvents.filter(event => !this.eventsById[event._id])

        logger.info(`autoRecordingManager - processEvents() - started - eventsToAdd -> ${eventsToAdd.map(event => event._id).join(', ')}`, { eventName: 'AUTO_RECORDING_MANAGER' })
        for (let newEvent of eventsToAdd) {

            let eventData = newEvent.eventData && newEvent.eventData.data ? JSON.parse(newEvent.eventData.data) : null

            let imageResponse
            if (eventData && eventData.imageData) {
                imageResponse = await uploadBase64ImageToOpenAIFile(eventData.clickId, eventData.imageData)
            }

            if (!eventData || !imageResponse) {
                continue
            }

            newEvent.eventData = eventData
            newEvent.imageResponse = imageResponse

            this.events.push(newEvent)
            this.eventsById[newEvent._id] = newEvent
        }

        logger.info(`autoRecordingManager - processEvents() - finished - eventsToAdd -> ${eventsToAdd.map(event => event._id).join(', ')}`, { eventName: 'AUTO_RECORDING_MANAGER' })

        return true
    }


    async finalize() {


        let finalUserMessage = `This is the order of the images and events that represent a user interaction with a website:
            ${
            JSON.stringify(this.events.map((event, index) => {
                let newIndex = ++index
                return {
                    index: newIndex, 
                    imageId: event.imageResponse.id,
                    imageResolution: {
                        width: Math.ceil(this.windowMeasures.innerWidth * this.windowMeasures.devicePixelRatio),
                        height: Math.ceil(this.windowMeasures.innerHeight * this.windowMeasures.devicePixelRatio),
                    }
                }
            }), null, 2)
        }
        ROLE
You are a world-class Sales Engineer with deep experience creating short, high-conversion SaaS demo flows.

INPUT CONTEXT
- You are provided with multiple screenshots.
- Screenshots are ordered chronologically and represent one continuous user session.
- Each screenshot represents the visible browser window at that moment in time.

TASK
Generate exactly **3 distinct demo flows** that a sales engineer would realistically present during a live demo.
Each demo flow should highlight a meaningful product capability, value moment, or user outcome.

OUTPUT REQUIREMENTS
Produce exactly **3 unique demo flows**.

Each demo flow must:
- Contain **4 to 10 steps max**
- Have a 'name' that **starts with "How to"**
- Include a short 'description'
- Represent a logical and compelling user journey derived strictly from the screenshots and always start with the first event/picture and build from there

STEP REQUIREMENTS
Each step must:
- Be one of the following types only:
  - "click"
  - "edit"
- Include:
  - 'x coordinate (number)
  - 'y' coordinate (number)
  - 'explanation' - a short imperative instruction (e.g. “Click the Create Demo button”)
  - The corresponding 'image' from the uploaded images

CONSTRAINTS
- Steps must logically follow the visual flow of the session
- Keep flows impactful but start from the first screenshot
- Do NOT include any text outside the JSON
- The response must be **strictly valid JSON** and fully parsable

COORDINATE SYSTEM & SCALING (IMPORTANT)
The uploaded images may have resolutions that differ from the browser window dimensions.

Treat the browser window as the single authoritative coordinate space:
- Origin (0,0) is the top-left corner of the browser viewport
- The viewport size is exactly:
  windowMeasures: ${JSON.stringify(this.windowMeasures)}

If an image is larger or smaller than the window dimensions:
- Assume the image represents the same viewport, but at a different resolution
- Uniformly scale the image to fit the window dimensions
- Do NOT apply cropping, padding, or offsets
- Preserve aspect ratio

When determining click or edit locations:
- First identify the target location in the original image coordinates
- Then scale the coordinates proportionally to the window dimensions
- The coordinates should represent valid mouse clicks
- Return ONLY the final scaled \`x\` and \`y\` values relative to \`windowMeasures\`

All returned coordinates MUST:
- Be within the window bounds
- Use integer pixel values
- Be valid for direct execution by a Chrome extension

OUTPUT FORMAT
Return **only JSON** matching this schema:

{
  "flows": [
    {
      "name": "How to …",
      "description": "…",
      "steps": [
        {
          "type": "click | edit",
          "x": number,
          "y": number,
          "explanation": string,
          "imageId": "image_reference"
        }
      ]
    }
  ]
}
 
                `

        // Build content array for OpenAI Responses API
        let msgContent = [
            {type: "input_text", text: finalUserMessage},
        ]

        this.events.forEach(event => {
            if (event.imageResponse && event.imageResponse.id) {
                msgContent.push(
                    {
                        type: "input_image",
                        file_id: event.imageResponse.id,
                        "detail": "high"
                    }
                )
            }
        })

        let createRequestBody = {
            model: model,
            input: [
                {
                    role: "user",
                    content: msgContent
                }
            ]
        }
        logger.info(`autoRecordingManager - finalize() - started - createRequestBody:\n ${JSON.stringify(createRequestBody, null, 2)} \n`, { eventName: 'AUTO_RECORDING_MANAGER' })

        const finalResponse = await openai.responses.create(createRequestBody);

        if (
            finalResponse &&
            finalResponse.output_text
        ) {
            logger.info('\n=== FINAL EXTRACTION RESULT ===', { eventName: 'FINAL_EXTRACTION_RESULT' });
            logger.info(` plain text - ${finalResponse.output_text}`, { eventName: 'AUTO_RECORDING_MANAGER' })
            if(finalResponse.output_text.startsWith('```json')) {
                finalResponse.output_text = finalResponse.output_text.slice(7, finalResponse.output_text.length-3)
            }
            let rawResult = JSON.parse(finalResponse.output_text);
            let flows = rawResult.flows

            let finalResult = this.mapScreenshotsToSuggestions(flows)
            // console.log(JSON.stringify(finalResult, null, 2));

            logger.info(`autoRecordingManager - finalize() - finished`, { eventName: 'AUTO_RECORDING_MANAGER' })

            return finalResult
        }

        logger.error('Failed to get valid content from OpenAI response', { eventName: 'FAILED_TO_GET_VALID_CONTENT_FROM_OPENAI_RESPONSE_FAILED' });
        logger.error(finalResponse, { eventName: 'AUTO_RECORDING_MANAGER_FAILED' });
        return null
    }


    /*
    steps: [
          {
            "type": "click",
            "x": 210,
            "y": 92,
            "imageId": "file-FJQvg46TM6UN29upJ4hy4z",
            "explanation": "On the Analytics page, click the date range dropdown to choose what period you want to analyze."
          },
        ]

    TO THIS
    steps: [
          {
            "type": "click",
            "x": 210,
            "y": 92,
            "openAiImageId": "file-FJQvg46TM6UN29upJ4hy4z",
            "autoRecordingEventId": "",
            "explanation": "On the Analytics page, click the date range dropdown to choose what period you want to analyze."
          },
        ]
     */
    mapScreenshotsToSuggestions(demoSuggestions) {
        const results = demoSuggestions.map(suggestion => {
            let thumbnailImageData = null
            let newSteps = suggestion.steps.map((step, index) => {
                let event = this.events.find(event => event.imageResponse.id === step.imageId)

                // step.y = Math.max(0, step.y - 40)
                step.openAiImageId = suggestion.imageId
                step.autoRecordingEventId = event ? event._id : null
                delete step.imageId

                if (index === 0) {
                    thumbnailImageData = event.eventData.imageData
                }

                return step
            })

            suggestion.steps = newSteps
            suggestion.thumbnailImageData = thumbnailImageData

            return suggestion
        })

        return results
    }

// Deletes all OpenAI images that were uploaded and tracked in this.events
    async deleteAllUploadedOpenAiImages() {
        if (!this.events || !Array.isArray(this.events)) return;

        const imageIds = this.events
            .map(e => e.imageResponse && e.imageResponse.id)
            .filter(id => !!id);

        // Remove duplicates
        const uniqueImageIds = Array.from(new Set(imageIds));

        for (const imageId of uniqueImageIds) {
            try {
                await openai.files.delete(imageId);
                logger.info(`autoRecordingManager - deleteAllUploadedOpenAiImages() - Deleted OpenAI image file: ${imageId}`, { eventName: 'AUTO_RECORDING_MANAGER' });
            } catch (err) {
                logger.error(`autoRecordingManager - deleteAllUploadedOpenAiImages() - Failed to delete OpenAI image file ${imageId}:`, { eventName: 'AUTO_RECORDING_MANAGER_FAILED', data: { detail: err.message || err } });
            }
        }
    }
}


export {
    AutoRecordingManager,
}
