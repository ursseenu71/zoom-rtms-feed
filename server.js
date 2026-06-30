// Import necessary libraries
import express from 'express';
import crypto from 'crypto';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import {post} from './services/http-service.js';

import helmet from "helmet";
import say from "say";
import {chatWithTranscript} from "./LLM.js";

// Load environment variables from a .env file
dotenv.config();

const app = express();
const queue = [];
let jiraTickets = [];
const server = http.createServer(app);
// Enable CORS so the Zoom App iframe can connect securely
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 2. Configure Strict OWASP Security Headers required by the Zoom Client
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // 1. Added 'unsafe-hashes' to allow safe JS framework handshakes if needed
                scriptSrc: ["'self'", "https://appssdk.zoom.us", "'unsafe-inline'", "'unsafe-hashes'"],
                // 2. Explicitly whitelist attribute executions
                scriptSrcAttr: ["'unsafe-inline'"],
                connectSrc: ["'self'", "https://*.ngrok-free.dev", "wss://*.ngrok-free.dev", "https://*.ngrok-free.app", "wss://*.ngrok-free.app", "http://localhost:*", "ws://localhost:*"],
                frameAncestors: ["'self'", "https://*.zoom.us", "https://zoom.us"],
                imgSrc: ["'self'", "data:"],
                styleSrc: ["'self'", "'unsafe-inline'"],
            },
        },
        referrerPolicy: { policy: "no-referrer-when-downgrade" },
        noSniff: true,
    })
);

// 3. Satisfies: "Strict-Transport-Security" (HSTS)
// Forces HTTPS connections inside the Zoom Client environment
app.use((req, res, next) => {
    res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload"
    );
    next();
});

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the frontend static files (the Zoom App iframe content)
app.use(express.static(path.join(__dirname, 'public')));

const stanShortResponseAudio = path.join(__dirname, 'stan-short-response.wav');
const ACTION_ITEM_KEYWORDS = ["Hey Stan", "Hey, Stan", "Hey,Stan", "Hello, Stan", "Hello Stan", "Hello,Stan"];
// const SKIP_KEYWORDS = ["I am STAN", "STAN SPEAKING", "STAN SPEAKING!", "I am STAN", "I'm STAN", "That is from STAN"];

let actionItemsText = fs.readFileSync(path.join(__dirname, 'action-items.txt'), 'utf8');
let finalUpdates;

const port = process.env.PORT || 3000;
const execAsync = promisify(exec);

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;
const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';

let isConversationTrackingON = false;

// Middleware to parse JSON bodies in incoming requests
app.use(express.json());

// 🆕 Serve the static files from the /public folder
app.use(express.static('public'));

// 🆕 CORS headers for HLS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader(
        "Content-Security-Policy",
        "frame-ancestors 'self' https://*.zoom.us https://zoom.us;"
    );
    res.removeHeader('X-Frame-Options');
    next();
});

// Map to keep track of active WebSocket connections and audio chunks
const activeConnections = new Map();

const RECONNECT_DELAY = 3000;
const MAX_DUPLICATE_SIGNAL_RETRIES = Number(process.env.MAX_DUPLICATE_SIGNAL_RETRIES || 3);
const INITIAL_DUPLICATE_SIGNAL_RETRY_DELAY_MS = Number(process.env.INITIAL_DUPLICATE_SIGNAL_RETRY_DELAY_MS || 1500);

io.on('connection', (socket) => {
    console.log('A Zoom App instance connected:', socket.id);

    socket.on("ACTIVATE_STAN", async () => {
        console.log('STAN Activated! Generating audio Intro');
        const llmResponse = await chatWithTranscript("STAN is activated from the Zoom App. Generate a greeting message from STAN end to the participants");
        console.log("\n--- Raw JSON Payload Received From STAN ---");
        console.log(JSON.stringify(llmResponse, null, 2));
        console.log("-------------------------------------------\n");
        const {audioResponse, uiDisplay} = llmResponse;
//        const {summary, actionItems, jiraUpdates, slackNotifications} = uiDisplay;

        // API Call to JIRA MCP Server to get the context of the projects that the participants belong to. User the access token of the participants to pull the jira information.


        generateAudio(llmResponse, stanShortResponseAudio);
    });

    socket.on('PAUSE_CONVERSATION_TRACKING', () => {
        console.log('pausing the conversation tracking');
        isConversationTrackingON = false;
    });
    socket.on('START_CONVERSATION_TRACKING', () => {
        console.log('enabling the conversation tracking');
        isConversationTrackingON = true;
    });

    socket.on('disconnect', () => {
        console.log('Zoom App instance disconnected.');
    });
});

function playStanAudio(fileName) {
    console.log("playing Stan Audio");
//    isConversationTrackingON = false;
    fs.readFile(fileName, (err, buffer) => {
        if (err) {
            console.error("Failed to read audio file:", err);
            return;
        }
        // 2. Emit the raw binary buffer directly down to the Zoom app iframe
        io.emit('PLAY_STAN_AUDIO', buffer);
    });
}

function generateAudio(llmResponse, outputFilePath) {
    say.export(llmResponse.audioResponse, "Daniel", 1.0, outputFilePath, (err) => {
        if (err) {
            return console.error("❌ Failed to generate audio:", err);
        }
        console.log(`✅ Success! Audio file saved directly to: ${outputFilePath}`);
        console.log('playing the audio now');
        playStanAudio(outputFilePath);
        const { audioResponse, uiDisplay } = llmResponse;

        // Define a helper function to emit messages and reduce boilerplate
        const emitStanMessage = (data) => {
            io.emit('STAN_TEXT_RESPONSE', {
                speaker: 'STAN',
                text: JSON.stringify(data),
                timestamp: new Date().toLocaleTimeString()
            });
        };

        // 1. Always emit the audio response
        emitStanMessage(audioResponse);

        // 2. Loop through the optional UI display fields and emit if they exist
        const updateFields = [
            'actionItems',
            'jiraUpdates',
            'slackNotifications',
            'emailUpdates',
            'serviceNowIncidentUpdates'
        ];

        updateFields.forEach(field => {
            const targetArray = uiDisplay[field];
            if (Array.isArray(targetArray) && targetArray.length > 0) {
                emitStanMessage(targetArray);
            }
        });
    });
}

function getOrCreateConnection(streamId) {
    if (!activeConnections.has(streamId)) {
        activeConnections.set(streamId, {
            shouldReconnect: true,
            _duplicateSignalRetryCount: 0,
            _signalingConnectLocked: false,
            _signalingConnectSocket: null,
        });
    }

    return activeConnections.get(streamId);
}

function clearTimer(timer) {
    if (timer) {
        clearTimeout(timer);
    }
}

function clearSignalingTimers(conn) {
    clearTimer(conn._signalingReconnectTimer);
    clearTimer(conn._duplicateSignalRetryTimer);
    conn._signalingReconnectTimer = null;
    conn._duplicateSignalRetryTimer = null;
}

function releaseSignalingConnectLock(conn, socket) {
    if (conn._signalingConnectSocket === socket) {
        conn._signalingConnectLocked = false;
        conn._signalingConnectSocket = null;
    }
}

function closeSocketQuietly(socket) {
    if (!socket) return;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
    }
}


// Handle POST requests to the webhook endpoint
app.post(WEBHOOK_PATH, (req, res) => {
    // Respond with HTTP 200 status
    res.sendStatus(200);
//    console.log('RTMS Webhook received:', JSON.stringify(req.body, null, 2));
    const { event, payload } = req.body;

    // Handle URL validation event
    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        // Generate a hash for URL validation using the plainToken and a secret token
        const hash = crypto
            .createHmac('sha256', ZOOM_SECRET_TOKEN)
            .update(payload.plainToken)
            .digest('hex');
        console.log('Responding to URL validation challenge');
        return res.json({
            plainToken: payload.plainToken,
            encryptedToken: hash,
        });
    }

    // Handle RTMS started event
    if (event === 'meeting.rtms_started') {
        console.log('RTMS Started event received');
        const { meeting_uuid, rtms_stream_id, server_urls } = payload;
        connectToSignalingWebSocket(meeting_uuid, rtms_stream_id, server_urls);
    }

    // Handle RTMS stopped event
    if (event === 'meeting.rtms_stopped') {
        console.log('RTMS Stopped event received');
        const { rtms_stream_id } = payload;
        stopStreaming(rtms_stream_id);
    }
});

// Function to generate a signature for authentication
function generateSignature(CLIENT_ID, meetingUuid, streamId, CLIENT_SECRET) {
    console.log('Generating signature with parameters:');
    console.log('meetingUuid:', meetingUuid);
    console.log('streamId:', streamId);

    // Create a message string and generate an HMAC SHA256 signature
    const message = `${CLIENT_ID},${meetingUuid},${streamId}`;
    return crypto.createHmac('sha256', CLIENT_SECRET).update(message).digest('hex');
}

// Function to connect to the signaling WebSocket server
function connectToSignalingWebSocket(meetingUuid, streamId, serverUrl) {
    console.log(`Connecting to signaling WebSocket for stream ${streamId}`);

    const conn = getOrCreateConnection(streamId);
    conn.meetingUuid = meetingUuid;
    conn.streamId = streamId;
    conn.serverUrl = serverUrl;

    if (conn._signalingConnectLocked) {
        console.warn(`[Signaling] Connect already in progress for stream ${streamId}. Skipping duplicate connect.`);
        return;
    }

    if (conn.signaling) {
        const existingState = conn.signaling.readyState;
        if (existingState !== WebSocket.CLOSED) {
            console.warn(`[Signaling] Already connected/connecting for stream ${streamId}. Skipping duplicate connect.`);
            return;
        }
    }

    clearSignalingTimers(conn);
    conn._signalingConnectLocked = true;

    const ws = new WebSocket(serverUrl);
    conn._signalingConnectSocket = ws;

    conn.signaling = ws;

    ws.on('open', () => {
        if (conn.signaling !== ws) {
            console.warn(`[Signaling] Opened stale socket for stream ${streamId}; closing it.`);
            closeSocketQuietly(ws);
            return;
        }

        console.log(`Signaling WebSocket connection opened for stream ${streamId}`);
        const signature = generateSignature(
            CLIENT_ID,
            meetingUuid,
            streamId,
            CLIENT_SECRET
        );

        // Send handshake message to the signaling server
        const handshake = {
            msg_type: 1, // SIGNALING_HAND_SHAKE_REQ
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            sequence: Math.floor(Math.random() * 1e9),
            signature,
            buffer_data: false,
        };
        conn._signalingHandshakeInFlight = true;
        ws.send(JSON.stringify(handshake));
        console.log('Sent handshake to signaling server');

    });

    ws.on('message', (data) => {
        if (conn.signaling !== ws) {
            console.warn(`[Signaling] Ignoring message from stale socket for stream ${streamId}.`);
            return;
        }

        const msg = JSON.parse(data);
//        console.log('Signaling Message:', JSON.stringify(msg, null, 2));
        const isDuplicateSignalRequest = String(msg.reason || '').toLowerCase().includes('duplicate signal request');

        // Handle successful handshake response
        if (msg.msg_type === 2 && msg.status_code === 0) { // SIGNALING_HAND_SHAKE_RESP
            conn._signalingHandshakeInFlight = false;
            releaseSignalingConnectLock(conn, ws);
            conn._duplicateSignalRetryCount = 0;
            if (conn._duplicateSignalRetryTimer) {
                clearTimeout(conn._duplicateSignalRetryTimer);
                conn._duplicateSignalRetryTimer = null;
            }
            const mediaUrl = msg.media_server?.server_urls?.all;
            if (mediaUrl) {
                connectToMediaWebSocket(mediaUrl, meetingUuid, streamId, ws);
            }
        } else if (msg.msg_type === 2) {
            conn._signalingHandshakeInFlight = false;
            releaseSignalingConnectLock(conn, ws);
            if (isDuplicateSignalRequest && conn.shouldReconnect) {
                if (conn._duplicateSignalRetryCount < MAX_DUPLICATE_SIGNAL_RETRIES) {
                    const delay = INITIAL_DUPLICATE_SIGNAL_RETRY_DELAY_MS * (2 ** conn._duplicateSignalRetryCount);
                    conn._duplicateSignalRetryCount += 1;
                    if (conn._duplicateSignalRetryTimer) clearTimeout(conn._duplicateSignalRetryTimer);
                    conn._suppressNextSignalingCloseReconnect = ws;
                    conn._duplicateSignalRetryTimer = setTimeout(() => {
                        conn._duplicateSignalRetryTimer = null;
                        connectToSignalingWebSocket(conn.meetingUuid, streamId, conn.serverUrl);
                    }, delay);
                    closeSocketQuietly(ws);
                    console.warn(`[Signaling] Duplicate signal request for stream ${streamId} (status ${msg.status_code}), retrying in ${delay}ms`);
                } else {
                    console.error(`[Signaling] Duplicate signal retries exhausted for stream ${streamId} (status ${msg.status_code})`);
                }
            } else {
                conn._suppressNextSignalingCloseReconnect = ws;
                console.error(`[Signaling] Handshake failed for stream ${streamId}:`, msg);
                closeSocketQuietly(ws);
            }
        }

        // Everytime a new participant joins, pull the jira tickets related to the participant.
        if (msg.msg_type === 6) {
           // TODO: Enable Jira MCP Server call once the SSP is approved to make API calls from Zoom App
       //     jiraTickets.push(fetchMeetingJiraTickets(msg.event.participants));
        }

        // Respond to keep-alive requests
        if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
            const keepAliveResponse = {
                msg_type: 13, // KEEP_ALIVE_RESP
                timestamp: msg.timestamp,
            };
//            console.log('Responding to Signaling KEEP_ALIVE_REQ:', keepAliveResponse);
            ws.send(JSON.stringify(keepAliveResponse));
        }
    });

    ws.on('error', (err) => {
        const activeConn = activeConnections.get(streamId);
        if (activeConn) {
            activeConn._signalingHandshakeInFlight = false;
            releaseSignalingConnectLock(activeConn, ws);
        }
        console.error('Signaling socket error:', err);
    });

    ws.on('close', () => {
        console.log('Signaling socket closed');
        const activeConn = activeConnections.get(streamId);
        if (activeConn) {
            activeConn._signalingHandshakeInFlight = false;
            releaseSignalingConnectLock(activeConn, ws);

            if (activeConn.signaling === ws) {
                delete activeConn.signaling;
            }

            const suppressReconnect = activeConn._suppressNextSignalingCloseReconnect === ws;
            if (suppressReconnect) {
                activeConn._suppressNextSignalingCloseReconnect = null;
                return;
            }

            if (activeConn.shouldReconnect) {
                console.log(`🔄 Signaling reconnecting in ${RECONNECT_DELAY}ms...`);
                activeConn._signalingReconnectTimer = setTimeout(() => {
                    activeConn._signalingReconnectTimer = null;
                    if (activeConn.shouldReconnect) {
                        connectToSignalingWebSocket(activeConn.meetingUuid, streamId, activeConn.serverUrl);
                    }
                }, RECONNECT_DELAY);
            }
        }
    });
}

function connectToMediaWebSocket(mediaUrl, meetingUuid, streamId, signalingSocket) {
    console.log(`Connecting to media WebSocket at ${mediaUrl}`);

    const conn = activeConnections.get(streamId);
    conn.mediaUrl = mediaUrl;

    const mediaWs = new WebSocket(mediaUrl, { rejectUnauthorized: false });
    conn.media = mediaWs;

    mediaWs.on('open', () => {
        const signature = generateSignature(CLIENT_ID, meetingUuid, streamId, CLIENT_SECRET);
        const handshake = {
            msg_type: 3,
            protocol_version: 1,
            meeting_uuid: meetingUuid,
            rtms_stream_id: streamId,
            signature,
            media_type: 32,
            payload_encryption: false,
            media_params: {
                audio: {
                    content_type: 2,
                    sample_rate: 1,
                    channel: 1,
                    codec: 1,
                    data_opt: 1,
                    send_rate: 100
                },
                video: {
                    content_type: 3,
                    codec: 7, //H264
                    resolution: 2,
                    fps: 25
                }
            }
        };
        mediaWs.send(JSON.stringify(handshake));
        console.log('✅ Media WebSocket connected and handshake sent');
    });

    mediaWs.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.msg_type === 4 && msg.status_code === 0) {
                signalingSocket.send(JSON.stringify({
                    msg_type: 7,
                    rtms_stream_id: streamId,
                }));
                console.log('✅ Media handshake successful');
            }

            if (msg.msg_type === 12) {
                mediaWs.send(JSON.stringify({
                    msg_type: 13,
                    timestamp: msg.timestamp,
                }));
            }

            if (msg.msg_type === 17) {
                if (!isConversationTrackingON) {
                    console.log('Conversation Tracking is currently not enabled or transcripts have skip keywords. Not recording the current transcript')
                    return;
                }
                console.log('Transcript Received')
                const transcript = msg.content.data;
                const timeStamp = new Date(msg.content.timestamp).toISOString().slice(11, 23).replace('.', ':');
                const formatedTranscript = `User: ${msg.content.user_name} \n User Id: ${msg.content.user_id} \n Text: ${msg.content.data}`;
                const conversation = `${timeStamp} \n <v ${msg.content.user_name}>${msg.content.data}</v>`
                console.log(conversation)
                queue.push(conversation);
                console.log(queue);
                io.emit('STAN_TEXT_RESPONSE', {
                    speaker: msg.content.user_name,
                    text: transcript,
                    timestamp: new Date().toLocaleTimeString()
                });
                const matchedKeyword = ACTION_ITEM_KEYWORDS.find(keyword => transcript.toLowerCase().includes(keyword.toLowerCase()));
                console.log("Transcript is " + transcript.toLowerCase(), "matchedKeyWord - " + matchedKeyword)
                if (matchedKeyword) {
                    isConversationTrackingON = false;
                    io.emit('STAN_TEXT_RESPONSE', {
                        speaker: "STAN",
                        text: "Processing the request..",
                        timestamp: new Date().toLocaleTimeString()
                    });
                    console.log(`Triggered Keyword ${matchedKeyword}. Making LLM Call with the conversation`)
                    const llmResponse = await chatWithTranscript(queue, jiraTickets);
                    console.log("\n--- Raw JSON Payload Received From STAN ---");
                    console.log(JSON.stringify(llmResponse, null, 2));
                    console.log("-------------------------------------------\n");
                    const { audioResponse, uiDisplay } = llmResponse;
                    const { summary, actionItems, jiraUpdates, slackNotifications, emailUpdates, serviceNowIncidentUpdates } = uiDisplay;

                    generateAudio(llmResponse, stanShortResponseAudio);

                    console.log(`Audio response from LLM is ${audioResponse}`)

                    /*io.emit('STAN_TEXT_RESPONSE', {
                        speaker: msg.content.user_name,
                        text: actionItems,
                        timestamp: new Date().toLocaleTimeString()
                    });*/
                }
            }

        } catch (err) {
            console.error('❌ Error processing media message:', err);
        }
    });

    mediaWs.on('error', (err) => {
        console.error('❌ Media WebSocket error:', err);
    });

    mediaWs.on('close', () => {
        console.log('🛑 Media WebSocket closed');
        const conn = activeConnections.get(streamId);
        if (conn) {
            delete conn.media;
            if (conn.shouldReconnect && conn.signaling?.readyState === WebSocket.OPEN) {
                console.log(`🔄 Media reconnecting in ${RECONNECT_DELAY}ms...`);
                setTimeout(() => {
                    if (conn.shouldReconnect) {
                        connectToMediaWebSocket(conn.mediaUrl, conn.meetingUuid, streamId, conn.signaling);
                    }
                }, RECONNECT_DELAY);
            } else if (conn.shouldReconnect) {
                console.log('🔄 Signaling not ready, will reconnect media after signaling reconnects');
            }
        }
    });
}

function stopStreaming(streamId) {
    const conn = activeConnections.get(streamId);
    if (!conn) return;

    conn.shouldReconnect = false;
    conn._suppressNextSignalingCloseReconnect = conn.signaling || null;
    clearSignalingTimers(conn);
    releaseSignalingConnectLock(conn, conn._signalingConnectSocket);

    if (conn.media) {
        conn.media.close();
    }
    if (conn.signaling) {
        conn.signaling.close();
    }

    activeConnections.delete(streamId);
    console.log(`🛑 Stopped streaming for stream: ${streamId}`);
}

// Start the server and listen on the specified port
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Webhook endpoint available at http://localhost:${port}${WEBHOOK_PATH}`);
    console.log(`Player available at http://localhost:${port}/player`);
});