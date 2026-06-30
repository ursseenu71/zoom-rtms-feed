
export async function post(payload) {
    const targetUrl = 'https://jira.com/endpoint';

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                 'Authorization': process.env.AuthToken
            },
            body: JSON.stringify(payload) // Convert your JavaScript object to a string
        });

        // Check if the network request was successful (status 200-299)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.log('External API response:', responseData);
        return responseData;
    } catch (error) {
        console.error('Failed to make POST request:', error);
    }
}

export async function get(queryParams = {}) {
    // 1. Convert the queryParams object into a string (e.g., ?project=STAN&status=open)
    const queryString = new URLSearchParams(queryParams).toString();
    const baseUrl = 'https://jira.com/endpoint';
    const targetUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET', // Changed to GET
            headers: {
                'Content-Type': 'application/json',
                'Authorization': process.env.AuthToken
            }
            // Note: No 'body' property here!
        });

        // Check if the network request was successful (status 200-299)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.log('External API response:', responseData);
        return responseData;
    } catch (error) {
        console.error('Failed to make GET request:', error);
    }
}