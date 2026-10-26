import fs from 'fs';
import readline from 'readline';
import {google} from 'googleapis';
import ENV from '../../../envServer.js'

import logger from '../../logger.js'

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.insert'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const GMAIL_CONF = ENV.GMAIL


  authorize({
    client_id: GMAIL_CONF.CLIENT_ID,
    client_secret: GMAIL_CONF.CLIENT_SECRET,
    redirect_uris: GMAIL_CONF.REDIRECT_URIS
  })
    .then(oauth => {

      listLabels(oauth)
    })

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials) {
  return new Promise((resolve, reject) => {

    const {client_secret, client_id, redirect_uris} = credentials;
    const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) {
        resolve(getNewToken(oAuth2Client));
      } else {
        oAuth2Client.setCredentials(JSON.parse(token));
        resolve(oAuth2Client);

      }

      });
  })

}


/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client ) {

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    logger.info('Authorize this app by visiting this url:', { eventName: 'AUTHORIZE_THIS_APP_BY_VISITING_THIS_URL', data: { detail: authUrl } });
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();

      return new Promise((resolve, reject) => {

        oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          logger.error(err, { eventName: 'GENERATE_TOKEN_JSON_FAILED' })
          reject(err);
        }
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
          if (err) {
            logger.error(err, { eventName: 'GENERATE_TOKEN_JSON_FAILED' })
            reject(err);
          }
          logger.info('Token stored to', { eventName: 'TOKEN_STORED_TO', data: { detail: TOKEN_PATH } });
        });

        resolve(oAuth2Client);
      });

    });
  })

}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listLabels(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  gmail.users.labels.list({
    userId: 'me',
  }, (err, res) => {
    if (err) return logger.info('The API returned an error: ' + err, { eventName: 'GENERATE_TOKEN_JSON' });
    const labels = res.data.labels;
    if (labels.length) {
      logger.info('Labels:', { eventName: 'LABELS' });
      labels.forEach((label) => {
        logger.info(`- ${label.name}`, { eventName: 'GENERATE_TOKEN_JSON' });
      });
    } else {
      logger.info('No labels found.', { eventName: 'NO_LABELS_FOUND' });
    }
  });
}

export default authorize
