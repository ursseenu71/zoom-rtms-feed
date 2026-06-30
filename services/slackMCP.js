import fetch from 'node-fetch';

export async function postToSlackServer(token, { channel, text }) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text })
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.error);

    return { status: 'Sent', channel };
}

/**
 * Read historic conversations/messages from a specific channel.
 * Requires the 'channels:history', 'groups:history', 'im:history', or 'mpim:history' scope
 * depending on the channel type.
 */
export async function getSlackHistory(token, { channelId, limit = 20 }) {
    // 1. Build the target URL with query parameters (GET parameters)
    const baseUrl = 'https://slack.com/api/conversations.history';
    const queryParams = new URLSearchParams({
        channel: channelId,
        limit: limit.toString()
    }).toString();

    const targetUrl = `${baseUrl}?${queryParams}`;

    // 2. Make the GET request using the participant's OAuth token
    const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });

    const data = await response.json();

    // update with issues reported in slack
    // SLACK_ISSUES = data.24_hour_issues

    // Slack API returns errors inside a 200 OK response via an 'ok' boolean field
    if (!data.ok) {
        throw new Error(`Slack API Error: ${data.error}`);
    }

    // 3. Map and return a clean array of message logs
    return data.messages.map(msg => ({
        user: msg.user,         // Slack User ID
        text: msg.text,         // The message content
        timestamp: msg.ts       // Slack epoch timestamp string
    }));
}