// Sample environment variable: process.env.JIRA_PROJECTS = "STAN,ALPHA,BETA"

async function fetchMeetingJiraTickets(participantsArray) {
    try {
        // 1. Parse the projects from the environment variable into an array or fallback to empty
        const projects = process.env.JIRA_PROJECTS
            ? process.env.JIRA_PROJECTS.split(',')
            : [];

        // 2. Build the query parameters object
        const queryParams = {
            assignees: participantsArray.join(','), // Converts ['Alice', 'Bob'] to "Alice,Bob"
            projects: projects.join(',')            // Converts ['STAN', 'ALPHA'] to "STAN,ALPHA"
        };

        console.log('Fetching tickets with parameters:', queryParams);

        // 3. Invoke the GET method
        const tickets = await get(queryParams);

        if (tickets) {
            console.log('Successfully loaded tickets:', tickets);
            return tickets;
        }

    } catch (error) {
        console.error('Error invoking GET tickets method:', error);
    }
}

// --- Example Invocation ---
const participants = ['Srinivas Kumar Mayasula', 'John Doe', 'Jane Smith'];
fetchMeetingJiraTickets(participants);