import fetch from 'node-fetch';

/**
 * Helper to get the base URL for the Jira API
 */
const getBaseUrl = () => {
    const domain = process.env.JIRA_DOMAIN; // e.g., "your-company.atlassian.net"
    if (!domain) throw new Error("Missing JIRA_DOMAIN environment variable.");
    return `https://${domain}/rest/api/3`;
};


// method to retrieve the headless or user specific access token based on the requirement.
async function getJiraAccessToken(refreshToken) {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: process.env.JIRA_CLIENT_ID,
            client_secret: process.env.JIRA_CLIENT_SECRET,
            refresh_token: refreshToken
        })
    });

    const data = await response.json();
    return data.access_token; // Brand new valid 1-hour access token
}

/**
 * Existing Method: Adds a comment to a Jira ticket
 */
export async function updateJiraServer(token, { ticketId, comment }) {
    if (!comment) return { status: 'No changes', ticketId };

    const response = await fetch(`${getBaseUrl()}/issue/${ticketId}/comment`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            body: {
                type: "doc", version: 1,
                content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }]
            }
        })
    });

    if (!response.ok) throw new Error(`Jira Comment Error: ${response.status}`);
    return { status: 'Comment Added', ticketId };
}

/**
 * 1. Create a New Ticket in Jira
 */
export async function createJiraTicket(token, { projectKey, summary, description, issueType = "Task" }) {
    const response = await fetch(`${getBaseUrl()}/issue`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            fields: {
                project: { key: projectKey },
                summary: summary,
                description: {
                    type: "doc", version: 1,
                    content: [{ type: "paragraph", content: [{ type: "text", text: description }] }]
                },
                issuetype: { name: issueType }
            }
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Jira Create Error: ${data.errors ? JSON.stringify(data.errors) : response.status}`);

    return { status: 'Created', ticketId: data.key, url: data.self };
}

/**
 * 2. Pull Jira Tickets Based on Assignee Name (Using JQL)
 */
export async function getTicketsByAssignee(token, assigneeName) {
    // Encodes JQL query: assignee = "John Doe" AND statusCategory != Done
    const jql = encodeURIComponent(`assignee = "${assigneeName}" AND statusCategory != Done`);

    const response = await fetch(`${getBaseUrl()}/search?jql=${jql}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Jira Fetch Error: ${response.status}`);

    return data.issues.map(issue => ({
        ticketId: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name
    }));
}

/**
 * 3. Pull Jira Tickets Based on Project Key (Using JQL)
 */
export async function getTicketsByProject(token, projectKey) {
    // Encodes JQL query: project = "STAN" ORDER BY created DESC
    const jql = encodeURIComponent(`project = "${projectKey}" ORDER BY created DESC`);

    const response = await fetch(`${getBaseUrl()}/search?jql=${jql}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Jira Fetch Error: ${response.status}`);

    return data.issues.map(issue => ({
        ticketId: issue.key,
        summary: issue.fields.summary,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        status: issue.fields.status.name
    }));
}

/**
 * 4. Update the Status of a Jira Ticket (Using Transitions)
 * Note: Jira requires transitioning a ticket using a transition ID (e.g., "11", "21")
 * rather than a status name string like "In Progress".
 */
export