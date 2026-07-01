import express from 'express';
import { getFreshAccessToken } from '../services/tokenRefresher.js';
import { updateJiraServer } from '../services/jiraMCP.js';
import { postToSlackServer } from '../services/slackMCP.js';
import { sendOutlookEmail } from '../services/outlookMCP.js';

const router = express.Router();

export let zoomToken = '';

// A simple local in-memory cache substituting the database.
// Structure: Key = zoomToken (string), Value = Object containing platform refresh tokens.
export const localTokenCache = new Map([
    [
        "sample-zoom-token-abc-123", // Key
        {                            // Value
            jiraRefresh: "mock-jira-refresh-token",
            slackRefresh: "mock-slack-refresh-token",
            outlookRefresh: "mock-outlook-refresh-token",
            confluenceRefresh: "mock-confluence-refresh-token",
            servicenowRefresh: "mock-snow-refresh-token"
        }
    ]
]);

router.post('/api/authToken', async (req, res) => {
    try {
        // 1. Extract the Zoom Auth Token from headers
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Zoom token.' });
        }
        zoomToken = authHeader.split(' ')[1];

        // 2. Fetch platform refresh tokens from the local cache instead of the DB
        const cachedUserTokens = localTokenCache.get(zoomToken);

        if (!cachedUserTokens) {
            return res.status(404).json({ error: 'No linked third-party integrations found in cache for this session.' });
        }

        const results = {};
        const { actions } = req.body; // e.g., ['jira', 'slack', 'outlook']

        // 3. Dispatch requests conditionally, refreshing tokens on the fly

        // --- JIRA INTEGRATION ---
        if (actions.includes('jira') && cachedUserTokens.jiraRefresh) {
            // Get a fresh short-lived access token using your unified module
            const { accessToken, newRefreshToken } = await getFreshAccessToken('jira', cachedUserTokens.jiraRefresh);

            // Critical Step: Update the local cache with the rotated refresh token!
            cachedUserTokens.jiraRefresh = newRefreshToken;

            results.jira = await updateJiraServer(accessToken, {
                summary: "Updated via STAN Zoom App"
            });
        }

        // --- SLACK INTEGRATION ---
        if (actions.includes('slack') && cachedUserTokens.slackRefresh) {
            const { accessToken, newRefreshToken } = await getFreshAccessToken('slack', cachedUserTokens.slackRefresh);
            cachedUserTokens.slackRefresh = newRefreshToken;

            results.slack = await postToSlackServer(accessToken, {
                channel: "general",
                text: "STAN meeting recap processed successfully."
            });
        }

        // --- OUTLOOK INTEGRATION ---
        if (actions.includes('outlook') && cachedUserTokens.outlookRefresh) {
            const { accessToken, newRefreshToken } = await getFreshAccessToken('outlook', cachedUserTokens.outlookRefresh);
            cachedUserTokens.outlookRefresh = newRefreshToken;

            results.outlook = await sendOutlookEmail(accessToken, {
                to: "team@company.com",
                subject: "Meeting Action Items"
            });
        }

        // Save the updated token tracking objects back into the memory map
        localTokenCache.set(zoomToken, cachedUserTokens);

        return res.status(200).json({ status: 'Success', details: results });

    } catch (error) {
        console.error('MCP Dispatch Error:', error);
        return res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
});

export default router;