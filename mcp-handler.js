import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// Initialize the STAN MCP Server
const server = new Server(
    {
        name: "stan-mcp-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {}, // Informs the LLM that this server provides tools
        },
    }
);

/**
 * 1. Define the available tools to the LLM
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "update_jira_ticket",
                description: "Updates a Jira ticket's status or adds a comment.",
                inputSchema: {
                    type: "object",
                    properties: {
                        ticketId: { type: "string", description: "The Jira ticket ID (e.g., STAN-101)" },
                        status: { type: "string", description: "The new status (Optional)" },
                        comment: { type: "string", description: "Comment text to append (Optional)" }
                    },
                    required: ["ticketId"]
                }
            },
            {
                name: "send_slack_message",
                description: "Sends a direct or channel message on Slack.",
                inputSchema: {
                    type: "object",
                    properties: {
                        channel: { type: "string", description: "Channel name or ID (e.g., #general)" },
                        message: { type: "string", description: "The text content to send" }
                    },
                    required: ["channel", "message"]
                }
            },
            {
                name: "send_outlook_email",
                description: "Sends an email using the Outlook Graph API.",
                inputSchema: {
                    type: "object",
                    properties: {
                        to: { type: "string", description: "Recipient email address" },
                        subject: { type: "string", description: "Email subject line" },
                        body: { type: "string", description: "HTML or plain text body content" }
                    },
                    required: ["to", "subject", "body"]
                }
            },
            {
                name: "create_servicenow_incident",
                description: "Creates a technical incident report in ServiceNow.",
                inputSchema: {
                    type: "object",
                    properties: {
                        shortDescription: { type: "string", description: "Brief summary of the issue" },
                        urgency: { type: "string", enum: ["1", "2", "3"], description: "1=High, 2=Medium, 3=Low" },
                        comments: { type: "string", description: "Detailed notes" }
                    },
                    required: ["shortDescription"]
                }
            }
        ]
    };
});

/**
 * 2. Handle tool execution requests from the LLM
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Pull individual OAuth or API tokens from environment variables / session
    const tokens = {
        jira: process.env.JIRA_AUTH_TOKEN,
        slack: process.env.SLACK_OAUTH_TOKEN,
        outlook: process.env.OUTLOOK_ACCESS_TOKEN,
        snow: process.env.SERVICENOW_BASIC_AUTH // Base64 encoded "username:password"
    };

    try {
        switch (name) {
            case "update_jira_ticket":
                return await handleJira(args, tokens.jira);
            case "send_slack_message":
                return await handleSlack(args, tokens.slack);
            case "send_outlook_email":
                return await handleOutlook(args, tokens.outlook);
            case "create_servicenow_incident":
                return await handleServiceNow(args, tokens.snow);
            default:
                throw new Error(`Tool ${name} not found.`);
        }
    } catch (error) {
        return {
            content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }],
            isError: true
        };
    }
});

// Run the MCP Server over standard I/O (Stdio)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("STAN MCP Server running on Stdio transport layer.");