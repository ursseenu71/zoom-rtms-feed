// chatWithOpenAI.js

import dotenv from 'dotenv';
import OpenAI from "openai";

// Import your MCP service methods
import { createJiraTicket, updateJiraTicketStatus, updateJiraServer } from './services/jiraMCP.js';
import { postToSlackServer } from './services/slackMCP.js';
import { sendOutlookEmail } from './services/outlookMCP.js';
import { createServiceNowIncident } from './services/serviceNowMCP.js';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function getAudio(text) {}

/**
 * Sends a transcript to OpenAI and handles automated live MCP tool execution based on intent.
 */
export async function chatWithTranscriptLIVE(transcriptText, jiraTickets, authToken = null) {
    try {
        // 1. Define the tools available for the LLM to call
        const tools = [
            {
                type: "function",
                function: {
                    name: "createJiraTicket",
                    description: "Creates a new Jira issue ticket.",
                    parameters: {
                        type: "object",
                        properties: {
                            projectKey: { type: "string" },
                            summary: { type: "string" },
                            description: { type: "string" }
                        },
                        required: ["projectKey", "summary", "description"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "postToSlackServer",
                    description: "Sends a live chat notification message to a Slack channel.",
                    parameters: {
                        type: "object",
                        properties: {
                            channel: { type: "string" },
                            text: { type: "string" }
                        },
                        required: ["channel", "text"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "sendOutlookEmail",
                    description: "Sends a direct email via Outlook.",
                    parameters: {
                        type: "object",
                        properties: {
                            to: { type: "string" },
                            subject: { type: "string" },
                            body: { type: "string" }
                        },
                        required: ["to", "subject", "body"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "createServiceNowIncident",
                    description: "Creates a structural operations production incident ticket in ServiceNow.",
                    parameters: {
                        type: "object",
                        properties: {
                            shortDescription: { type: "string" },
                            urgency: { type: "string", enum: ["1", "2", "3"] },
                            comments: { type: "string" }
                        },
                        required: ["shortDescription"]
                    }
                }
            }
        ];

        // 2. Initial Call to OpenAI
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are STAN, an AI meeting assistant. Analyze the transcript. If the user explicitly asks to perform an action (like creating a ticket, sending an email, or messaging slack), invoke the corresponding tool.`
                },
                {
                    role: 'user',
                    content: `Transcript:\n\n${transcriptText}, Jira Tickets: ${jiraTickets}`,
                },
            ],
            tools: tools,
            tool_choice: "auto" // Let OpenAI decide if it should call a tool or just respond
        });

        const responseMessage = response.choices[0].message;

        // 3. Check if the LLM decided to execute an integration tool call
        if (responseMessage.tool_calls) {
            console.log("LLM detected operational intent. Executing MCP Server call...");

            // We loop over tool requests (though usually it'll be just one at a time)
            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                // Fallback token selection mechanism
                const token = authToken || process.env.AuthToken;

                let executionResult;

                // Dynamically direct parameters to the correct workspace file module
                switch (functionName) {
                    case "createJiraTicket":
                        executionResult = await createJiraTicket(token, functionArgs);
                        break;
                    case "postToSlackServer":
                        executionResult = await postToSlackServer(token, functionArgs);
                        break;
                    case "sendOutlookEmail":
                        executionResult = await sendOutlookEmail(token, functionArgs);
                        break;
                    case "createServiceNowIncident":
                        executionResult = await createServiceNowIncident(token, functionArgs);
                        break;
                }

                console.log(`MCP server action [${functionName}] successfully completed:`, executionResult);
                return {
                    status: "Executed",
                    tool: functionName,
                    result: executionResult
                };
            }
        }

        // 4. Fallback if no specific tool intent was detected (Returns normal conversational response text)
        return {
            status: "No Tool Called",
            message: responseMessage.content
        };

    } catch (err) {
        console.error('Error in Automated MCP routing structure pipeline:', err);
        throw err;
    }
}