// The story a public preview page renders (GET /urldemos/:id, GET /migratedemos/:id), screens sorted, with cursor positions.
// null when deleted
export default function findPreviewStory(Models, storyId) {
    return Promise.all([
        Models.Story.findOne({ _id: storyId, deletedAt: null })
            .populate({
                path: 'screens',
                populate: [
                    {
                        path: 'customTransitions.gotoScreen',
                        model: 'Screen',
                        select: '_id name'
                    },
                    {
                        path: 'steps.view.popup.formId',
                        model: 'Form',
                    },
                    {
                        path: 'steps.stepAudioId',
                        model: 'Audio',
                    },
                    {
                        path: 'steps.view.popup.buttons.gotoScreen',
                        model: 'Screen',
                    },
                    {
                        path: 'cursorPositions',
                        model: 'CursorPositions',
                    }
                ],
                select: '_id name type screens steps customTransitions width height imageUrl index asset playbackRate popups zoomSpans zoomSpan startTime endTime cursorPositions recordingRole baseScreenId fromTimeMs toTimeMs eventCount',
            })
            .populate('content.contentId'),
        Models.CursorPositions.find({ storyId }).lean()
    ]).then(([foundStory, cursorPositions]) => {
        const storyDoc = foundStory ? (foundStory.toObject ? foundStory.toObject() : foundStory) : null
        if (storyDoc) {

            if (Array.isArray(storyDoc.screens)) {

                storyDoc.screens.sort((a, b) => a.index - b.index)
            }
            storyDoc.cursorPositions = cursorPositions
        }
        return storyDoc
    })
}
