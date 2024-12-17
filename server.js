const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3001;

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Middleware to parse JSON bodies
app.use(express.json());

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists the labels in the user's account.
 */
async function listLabels(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.labels.list({
    userId: 'me',
  });
  return res.data.labels || [];
}

/**
 * Lists the last 5 emails in the user's inbox.
 */
async function listLastFiveEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  // List the messages in the user's inbox
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 5,
    
  });

  const messages = res.data.messages || [];
  const emailDetails = [];

  for (const message of messages) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full',
    });
    const email = msg.data;
    emailDetails.push({
      from: email.payload.headers.find((header) => header.name === 'From').value,
      subject: email.payload.headers.find((header) => header.name === 'Subject').value,
      date: email.payload.headers.find((header) => header.name === 'Date').value,
      content: email.content,
    });
  }

  return emailDetails;
}


async function searchEmails(auth, searchQuery, res) {
  const gmail = google.gmail({ version: 'v1', auth });

  // List the messages in the user's inbox based on the search query
  const emailList = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,  // Using the search query parameter
  });

  const messages = emailList.data.messages || [];

  // If no emails are found, send a response immediately
  if (messages.length === 0) {
    res.write('No emails found');
    res.end();
    return;
  }

  // Loop through the messages and stream each one as it is fetched
  for (const message of messages) {
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full',
      });

      const email = msg.data;
      const emailDetail = {
        from: email.payload.headers.find((header) => header.name === 'From').value,
        subject: email.payload.headers.find((header) => header.name === 'Subject').value,
        date: email.payload.headers.find((header) => header.name === 'Date').value,
        snippet: email.snippet,
      };

      // Write the email details to the response
      res.write(JSON.stringify(emailDetail) + '\n');
      
      // Send each email one at a time immediately as they are fetched
    } catch (error) {
      // Handle any errors for this email, but continue fetching the next one
      console.error(`Failed to fetch email with id ${message.id}:`, error);
    }
  }

  // End the response after all emails have been sent
  res.end();
}



/**
 * Sends an email.
 */
async function sendEmail(auth, to, subject, body) {
  const gmail = google.gmail({ version: 'v1', auth });

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    body,
  ].join('\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });
    return 'Email sent successfully!';
  } catch (error) {
    throw new Error(`Error sending email: ${error}`);
  }
}



// Route to get Gmail labels
app.get('/labels', async (req, res) => {
  try {
    const auth = await authorize();
    const labels = await listLabels(auth);
    res.json(labels);
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

// Route to get last 5 emails
app.get('/emails', async (req, res) => {
  const searchQuery = req.query.query || ''; // Retrieve the search query from the request

  try {
    const auth = await authorize();

    // Set headers for streaming JSON data
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Start streaming emails as they are found
    await searchEmails(auth, searchQuery, res);
    
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

app.get('/getemails', async (req, res) => {
  try {
    const auth = await authorize();
    const emails = await listLastFiveEmails(auth);
    res.json(emails);
  } catch (error) {
    res.status(500).send(error.toString());
  }
});



// Route to send email
app.post('/send-email', async (req, res) => {
  const { to, subject, body } = req.body;
  try {
    const auth = await authorize();
    const result = await sendEmail(auth, to, subject, body);
    res.json({ message: result });
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
