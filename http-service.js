
export async function post(payload) {
    const targetUrl = 'https://api.example.com/endpoint';

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