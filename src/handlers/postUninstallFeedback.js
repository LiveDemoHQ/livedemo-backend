import ResponseCodes from '../constants/ResponseCodes.js'
import { validateUninstallFeedback } from '../helpers/validators/feedbackBody.js'

const corsHeaders = {
  'Access-Control-Max-Age': 600,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'ClientId,Authorization,Content-Type,Accept',
  'Access-Control-Allow-Credentials': true,
}

const handler = function (req, res) {
  const { Models } = req.mongo
  const { error, value } = validateUninstallFeedback(req.body || {})

  if (error) {
    res.set(corsHeaders)
    res.status(ResponseCodes['400_BAD_REQUEST'])
    res.send(JSON.stringify({ error: error.message }))
    return
  }

  const doc = new Models.Feedback({
    reason: value.reason,
    message: value.message || '',
    source: 'chrome-uninstall',
    extensionVersion: value.extensionVersion || '',
  })

  return doc.save()
    .then((saved) => {
      res.set(corsHeaders)
      res.status(ResponseCodes['201_CREATED'])
      res.send(JSON.stringify({
        success: true,
        id: saved._id,
      }))
    })
    .catch((err) => {
      console.log(err)
      res.set(corsHeaders)
      res.status(ResponseCodes['500_INTERNAL_SERVER_ERROR'])
      res.send(JSON.stringify({ error: 'Failed to save feedback' }))
    })
}

export default handler
