import liveDemoHelpers from '../helpers/livedemoHelpers.js';
import { File } from 'node:buffer';
import { Readable } from 'stream';

if (typeof globalThis.File === 'undefined') {
    try {
        globalThis.File = File;
    } catch (e) {
        // Fallback for older Node.js versions or when node:buffer.File is unavailable
        // Optionally you can provide a polyfill or a warning
        logger.error('File API is not available. File uploads may fail. Please use Node.js 20 or newer.', { eventName: 'AUTO_RECORDING_MANAGER_BULK_FAILED' });
    }
}



const EventType = Object.freeze({
    0: "DomContentLoaded",
    1: "Load",
    2: "FullSnapshot",
    3: "IncrementalSnapshot",
    4: "Meta",
    5: "Custom",
    6: "Plugin",

    DomContentLoaded: 0,
    Load: 1,
    FullSnapshot: 2,
    IncrementalSnapshot: 3,
    Meta: 4,
    Custom: 5,
    Plugin: 6,
});

const IncrementalSource = Object.freeze({
    0: "Mutation",
    1: "MouseMove",
    2: "MouseInteraction",
    3: "Scroll",
    4: "ViewportResize",
    5: "Input",
    6: "TouchMove",
    7: "MediaInteraction",
    8: "StyleSheetRule",
    9: "CanvasMutation",
    10: "Font",
    11: "Log",
    12: "Drag",
    13: "StyleDeclaration",
    14: "Selection",
    15: "AdoptedStyleSheet",
    16: "CustomElement",

    Mutation: 0,
    MouseMove: 1,
    MouseInteraction: 2,
    Scroll: 3,
    ViewportResize: 4,
    Input: 5,
    TouchMove: 6,
    MediaInteraction: 7,
    StyleSheetRule: 8,
    CanvasMutation: 9,
    Font: 10,
    Log: 11,
    Drag: 12,
    StyleDeclaration: 13,
    Selection: 14,
    AdoptedStyleSheet: 15,
    CustomElement: 16,
});

const MouseInteractions = Object.freeze({
    0: "MouseUp",
    1: "MouseDown",
    2: "Click",
    3: "ContextMenu",
    4: "DblClick",
    5: "Focus",
    6: "Blur",
    7: "TouchStart",
    8: "TouchMove_Departed",
    9: "TouchEnd",
    10: "TouchCancel",

    MouseUp: 0,
    MouseDown: 1,
    Click: 2,
    ContextMenu: 3,
    DblClick: 4,
    Focus: 5,
    Blur: 6,
    TouchStart: 7,
    TouchMove_Departed: 8,
    TouchEnd: 9,
    TouchCancel: 10,
});

import OpenAI from "openai"

import logger from './logger.js'

const model = 'gpt-5.1'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Uploads a JSON object to OpenAI as a file for a given purpose.
 *
 * @param {Object} jsonObj - The JSON object to upload.
 * @param {string} [purpose="assistants"] - The purpose of the file as required by OpenAI.
 * @returns {Promise<Object>} The upload result object from OpenAI, which has the following structure:
 * 
 * {
 *   "id": "file-abc123",
 *   "object": "file",
 *   "bytes": 120000,
 *   "created_at": 1677610602,
 *   "expires_at": 1680202602,
 *   "filename": "salesOverview.pdf",
 *   "purpose": "assistants"
 * }
 */

async function uploadJsonToOpenAIFile(jsonObj, purpose = "user_data") {
    // Convert the JSON object to a Buffer and create a file object as required by openai.files.create
    const fileContent = Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8');
    // OpenAI SDK expects a file stream or a File-like object
    // We'll create a readable stream from the buffer for Node.js environments
    const stream = new Readable();
    stream.push(fileContent);
    stream.push(null); // End the stream

    // Construct file metadata (name is optional but helpful for tracking)
    const fileOptions = {
        file: {
            value: stream,
            options: {
                filename: 'data.json',
                contentType: 'application/json'
            }
        },
        purpose
    };

    // If OpenAI SDK supports direct file argument:
    // openai.files.create({ file, purpose })
    // But here we adapt for the node sdk v4 and above interface

    let file = await OpenAI.toFile(stream, 'data.json')
    try {
        const response = await openai.files.create({
            file: file,
            purpose: purpose,
        });
        return response;
    } catch (error) {
        logger.error('Failed to upload JSON file to OpenAI:', { eventName: 'FAILED_TO_UPLOAD_JSON_FILE_TO_OPENAI_FAILED', err: error });
        throw error;
    }
}


async function processAutoRecording(autoRecordingEvents, aiName) {

    await liveDemoHelpers.sleep(12)

    return []
}

class AutoRecordingManager {
    aiName = ''
    events = []
    eventsById = {}
    eventsCharCounter = 0


    constructor(aiName) {
        this.aiName = aiName
    }

    async processEventsBulk(newEvents) {
        if(!newEvents || newEvents.length === 0) {
            return false
        }

        let eventsToAdd = newEvents.filter(event => !this.eventsById[event._id])

        eventsToAdd.forEach(newEvent => {
            newEvent.message = JSON.stringify(newEvent)

            this.events.push(newEvent)
            this.eventsCharCounter += newEvent.message.length
            this.eventsById[newEvent._id] = newEvent
        })

        let eventsObj = this.events

        let uploadedFile = await uploadJsonToOpenAIFile(eventsObj, 'user_data')

        logger.info('uploadedFile', { eventName: 'UPLOADEDFILE', data: { detail: uploadedFile } })


        let finalUserMessage = `Now, based on the uploaded file events, provide the following information:
                     
You are a an amazing sales engineer with a lot of demo creating experiance. 
Given the page session recording of a SaaS site uploaded above, what's the most compelling 4 to 7 steps demo flow?"
produce a step-by-step demo flow that a Chrome extension can execute. 
Each step must be one of: click, edit. 
Add X and Y cordinates where to click and an explanation for each step.
Keep flows short (4–7 steps). 
Return the name of the flow and the description of the flow and only JSON matching the schema.
Give 3 unique examples.
And make sure the name of the demo starts with "How to"
And Write in imperative mood - give direct commands to the reader instead of describing what they do.
                `
        

        // Ensure the file type is provided when referencing the uploaded file.
        // Let's check that uploadedFile has .json extension and provide the file_type explicitly.

        const response = await openai.responses.create({
            model: model,
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: finalUserMessage },
                        {
                            type: "input_file",
                            file_id: uploadedFile.id,
                            // file_type: "json" // explicitly specify the file type
                        }
                    ]
                }
            ]
        });

          logger.info('response ', { eventName: 'RESPONSE', data: { detail: response.output_text } })

        
        return response
    }

}

export {
    AutoRecordingManager,
    EventType,
    IncrementalSource,
    MouseInteractions
}
