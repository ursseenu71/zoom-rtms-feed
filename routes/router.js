import express from 'express';
import { updateJiraServer } from '../services/jiraMCP.js';
import { postToSlackServer } from '../services/slackMCP.js';
import { sendOutlookEmail } from '../services/outlookMCP.js';

const router = express.Router();

router.post('/api/mcp/sync', async (req, res) => {
    try {
        // 1. Extract the Zoom Auth Token from headers
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Zoom token.' });
        }
        const zoomToken = authHeader.split(' ')[1];

        // 2. [Crucial Step] Decode token & look up user's saved OAuth tokens from DB
        // In real-world apps, you map the Zoom User ID to their respective Jira/Slack tokens.
        const userIntegrations = await db.findUserIntegrationsByZoomToken(zoomToken);

        if (!userIntegrations) {
            return res.status(404).json({ error: 'No linked third-party integrations found for this user.' });
        }

        const results = {};
        const { actions } = req.body; // e.g., ['jira', 'slack']

        // 3. Dispatch requests conditionally based on what's active/requested
        if (actions.includes('jira') && userIntegrations.jiraToken) {
            results.jira = await updateJiraServer(userIntegrations.jiraToken, {
                summary: "Updated via STAN Zoom App"
            });
        }

        if (actions.includes('slack') && userIntegrations.slackToken) {
            results.slack = await postToSlackServer(userIntegrations.slackToken, {
                channel: "general",
                text: "STAN meeting recap processed successfully."
            });
        }

        if (actions.includes('outlook') && userIntegrations.outlookToken) {
            results.outlook = await sendOutlookEmail(userIntegrations.outlookToken, {
                to: "team@company.com",
                subject: "Meeting Action Items"
            });
        }

        return res.status(200).json({ status: 'Success', details: results });

    } catch (error) {
        console.error('MCP Dispatch Error:', error);
        return res.status(500).json({ error: 'Internal Server Error processing MCP actions.' });
    }
});

export default router;