import fetch from 'node-fetch';

// 1. Centralized configuration map for all platforms
const PLATFORM_CONFIGS = {
    outlook: {
        getUrl: () => `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/oauth2/v2.0/token`,
        contentType: 'application/x-www-form-urlencoded',
        buildPayload: (refresh_token) => new URLSearchParams({
            client_id: process.env.OUTLOOK_CLIENT_ID,
            client_secret: process.env.OUTLOOK_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token,
            scope: 'offline_access https://graph.microsoft.com/.default'
        }).toString()
    },
    confluence: {
        getUrl: () => 'https://auth.atlassian.com/oauth/token',
        contentType: 'application/json',
        buildPayload: (refresh_token) => JSON.stringify({
            grant_type: 'refresh_token',
            client_id: process.env.CONFLUENCE_CLIENT_ID,
            client_secret: process.env.CONFLUENCE_CLIENT_SECRET,
            refresh_token
        })
    },
    jira: { // Jira and Confluence use the same Atlassian endpoint
        getUrl: () => 'https://auth.atlassian.com/oauth/token',
        contentType: 'application/json',
        buildPayload: (refresh_token) => JSON.stringify({
            grant_type: 'refresh_token',
            client_id: process.env.JIRA_CLIENT_ID,
            client_secret: process.env.JIRA_CLIENT_SECRET,
            refresh_token
        })
    },
    slack: {
        getUrl: () => 'https://slack.com/api/oauth.v2.access',
        contentType: 'application/x-www-form-urlencoded',
        buildPayload: (refresh_token) => new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID,
            client_secret: process.env.SLACK_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token
        }).toString()
    },
    servicenow: {
        getUrl: () => `https://${process.env.SERVICENOW_INSTANCE}.service-now.com/oauth_token.do`,
        contentType: 'application/x-www-form-urlencoded',
        buildPayload: (refresh_token) => new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.SERVICENOW_CLIENT_ID,
            client_secret: process.env.SERVICENOW_CLIENT_SECRET,
            refresh_token
        }).toString()
    }
};

/**
 * Common method to fetch a fresh access token for any integration platform
 * @param {('outlook'|'confluence'|'jira'|'slack'|'servicenow')} platform - Target platform name
 * @param {string} refreshToken - The active refresh token stored in the database
 * @returns {Promise<{accessToken: string, newRefreshToken: string}>}
 */
export async function getFreshAccessToken(platform, refreshToken) {
    const config = PLATFORM_CONFIGS[platform?.toLowerCase()];

    if (!config) {
        throw new Error(`Unsupported platform integration: ${platform}`);
    }

    try {
        const response = await fetch(config.getUrl(), {
            method: 'POST',
            headers: { 'Content-Type': config.contentType },
            body: config.buildPayload(refreshToken)
        });

        const data = await response.json();

        // Error handling variation: Slack returns 200 OK even on failure with an 'ok' flag
        if (!response.ok || (data.ok === false)) {
            throw new Error(data.error || data.error_description || `HTTP Error ${response.status}`);
        }

        return {
            accessToken: data.access_token,
            newRefreshToken: data.refresh_token || refreshToken // Fallback to current token if provider doesn't rotate it
        };

    } catch (error) {
        console.error(`Unified Refresh Failure for [${platform.toUpperCase()}]:`, error.message);
        throw error;
    }
}