import fetch from 'node-fetch';

export async function createServiceNowIncident(basicAuthToken, { shortDescription, urgency, comments }) {
    const instance = process.env.SERVICENOW_INSTANCE;

    const response = await fetch(`https://${instance}.service-now.com/api/now/table/incident`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basicAuthToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({
            short_description: shortDescription,
            urgency: urgency,
            comments: comments
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "ServiceNow Error");

    return { status: 'Created', incidentNumber: data.result.number };
}