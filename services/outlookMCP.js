import fetch from 'node-fetch';
import {EMAIL_ALERTS} from "../constants";

export async function sendOutlookEmail(token, { to, subject, body }) {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            message: {
                subject,
                body: { contentType: "Text", content: body },
                toRecipients: [{ emailAddress: { address: to } }]
            }
        })
    });

    if (!response.ok) throw new Error(`Outlook HTTP error: ${response.status}`);
    return { status: 'Emailed', to };
}

export async function getCriticalAlertEmails(token) {
    // 1. Calculate the timestamp for exactly 24 hours ago in ISO format
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 2. Build Microsoft Graph OData filter parameters
    // Filters for emails received after the timestamp AND containing 'critical alert' in the subject
    const queryParams = new URLSearchParams({
        '$filter': `receivedDateTime ge ${twentyFourHoursAgo} and contains(subject, 'critical alert')`,
        '$select': 'subject,receivedDateTime,bodyPreview,from', // Only fetch fields you need
        '$top': '10' // Limit results to the 10 most recent alerts
    }).toString();

    const targetUrl = `https://graph.microsoft.com/v1.0/me/messages?${queryParams}`;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Outlook Graph API error! Status: ${response.status}`);
        }

        const data = await response.json();

        // EMAIL_ALERTS = alerts TODO

        // 3. Map the response into a clean, simplified array of alerts
        return data.value.map(email => ({
            subject: email.subject,
            receivedAt: email.receivedDateTime,
            preview: email.bodyPreview,
            sender: email.from?.emailAddress?.address || 'Unknown'
        }));

    } catch (error) {
        console.error('Failed to fetch critical alert emails:', error);
        throw error;
    }
}