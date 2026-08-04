/**
 * UNS Sentinel Explorer - Node.js TCP Gateway
 * Handles raw TCP MQTT connections and forwards to React frontend via WebSocket
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Store active MQTT connections
const sessions = new Map();

// Track which sessions belong to which Socket.io client
const clientSessions = new Map(); // socket.id -> Set<sessionId>

/**
 * Build MQTT connection options.
 * Uses MQTT 3.1.1 (protocol version 4) by default — the most widely supported version.
 * MQTT 5.0 (version 5) is rejected by many brokers with "Unacceptable protocol version".
 */
function buildMqttOptions({
  clientId,
  username,
  password,
  protocolVersion = 4,
  connectTimeout = 10,
  keepAlive = 60,
  autoReconnect = true,
  cleanSession = true,
  sessionExpiryInterval,
  receiveMaximum,
  maximumPacketSize,
  topicAliasMaximum,
  requestResponseInfo,
  requestProblemInfo,
}) {
  const options = {
    clientId: clientId || `uns-explorer-${Math.random().toString(36).slice(2, 10)}`,
    clean: cleanSession,
    connectTimeout: connectTimeout * 1000, // Convert to milliseconds
    reconnectPeriod: autoReconnect ? 4000 : 0,
    keepalive: keepAlive,
    username: username || undefined,
    password: password || undefined,
    protocolVersion,
  };

  // MQTT 5.0 specific properties
  if (protocolVersion === 5) {
    if (sessionExpiryInterval !== undefined) options.sessionExpiryInterval = sessionExpiryInterval;
    if (receiveMaximum !== undefined) options.receiveMaximum = receiveMaximum;
    if (maximumPacketSize !== undefined) options.maximumPacketSize = maximumPacketSize;
    if (topicAliasMaximum !== undefined) options.topicAliasMaximum = topicAliasMaximum;
    if (requestResponseInfo !== undefined) options.requestResponseInfo = requestResponseInfo;
    if (requestProblemInfo !== undefined) options.requestProblemInfo = requestProblemInfo;
  }

  return options;
}

/**
 * Convert raw MQTT errors into human-readable messages.
 */
function getReadableError(err) {
  const msg = (err && err.message) || 'Unknown error';

  if (msg.includes('Unacceptable protocol version')) {
    return `Connection refused: Unacceptable protocol version — The broker does not support the MQTT protocol version being used. The server will automatically retry with MQTT 3.1.1 and MQTT 3.1.`;
  }
  if (msg.includes('ECONNRESET')) {
    return 'Connection reset by broker (ECONNRESET) - The broker forcibly closed the connection. This is common with public brokers like test.mosquitto.org.';
  }
  if (msg.includes('ECONNREFUSED')) {
    return 'Connection refused (ECONNREFUSED) - The broker is not running or not accepting connections on this port.';
  }
  if (msg.includes('ETIMEDOUT')) {
    return 'Connection timed out (ETIMEDOUT) - The broker did not respond within the timeout period.';
  }
  if (msg.includes('ENOTFOUND')) {
    return 'Host not found (ENOTFOUND) - The broker hostname could not be resolved.';
  }
  if (msg.includes('EHOSTUNREACH')) {
    return 'Host unreachable (EHOSTUNREACH) - The broker host is not reachable from this network.';
  }
  if (msg.includes('EPIPE')) {
    return 'Broken pipe (EPIPE) - The connection was broken while writing data.';
  }
  if (msg.includes('socket hang up')) {
    return 'Socket hang up - The broker closed the connection unexpectedly. Common with unstable public brokers.';
  }
  if (msg.includes('connack timeout')) {
    return 'Connection acknowledgement timeout - The broker did not respond to the connection request in time.';
  }
  if (msg.includes('Connection refused: Server busy')) {
    return 'Connection refused - The broker is busy and not accepting new connections. Try again later.';
  }
  return msg;
}

// API: Connect to MQTT broker
app.post('/api/broker/connect', (req, res) => {
  const { host, port, topics, protocol = 'mqtt', clientId, username, password } = req.body;
  
  console.log(`[Server] Received connection request:`, {
    host,
    port,
    protocol,
    clientId: clientId || '(auto-generated)',
    username: username ? '***' : '(none)',
    password: password ? '***' : '(none)',
    topics,
    topicCount: topics?.length
  });
  
  if (!host || !port || !topics || !Array.isArray(topics)) {
    console.error(`[Server] Invalid request - missing required fields`);
    return res.status(400).json({ error: 'Missing required fields: host, port, topics' });
  }

  const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Build MQTT connection URL
  const url = `${protocol}://${host}:${port}`;
  
  console.log(`[Server] Connecting to ${url} (session: ${sessionId})`);

  // Start with MQTT 3.1.1 (protocol version 4) — the most widely supported version.
  // MQTT 5.0 (version 5) is rejected by many brokers with "Unacceptable protocol version".
  const options = buildMqttOptions({ clientId, username, password, protocolVersion: 4 });

  try {
    console.log(`[Server] Attempting MQTT connection with options:`, {
      clientId: options.clientId,
      protocolVersion: options.protocolVersion,
      connectTimeout: options.connectTimeout,
      reconnectPeriod: options.reconnectPeriod
    });
    
    const client = mqtt.connect(url, options);

    client.on('connect', () => {
      console.log(`[Server] ✅ Connected to ${host}:${port} (session: ${sessionId})`);
      
      // Subscribe to all topics
      console.log(`[Server] Subscribing to ${topics.length} topics...`);
      topics.forEach(topic => {
        console.log(`[Server] Subscribing to topic: ${topic}`);
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            console.error(`[Server] ❌ Failed to subscribe to ${topic}:`, err);
          } else {
            console.log(`[Server] ✅ Subscribed to ${topic}`);
          }
        });
      });

      // Store session
      sessions.set(sessionId, {
        client,
        host,
        port,
        protocol,
        topics,
        connectedAt: Date.now()
      });

      console.log(`[Server] Session stored, sending success response`);
      res.json({ 
        success: true, 
        sessionId,
        message: `Connected to ${host}:${port}`
      });
    });

    client.on('message', (topic, payload) => {
      const message = {
        topic,
        payload: payload.toString(),
        timestamp: Date.now()
      };
      
      console.log(`[Server] 📨 Message received on ${topic} (${payload.length} bytes)`);
      
      // Emit to all connected frontend clients
      io.emit('mqtt:message', message);
    });

    client.on('error', (err) => {
      console.error(`[Server] ❌ MQTT error (session: ${sessionId}):`, err);
      console.error(`[Server] Error stack:`, err.stack);
      io.emit('mqtt:error', { sessionId, error: getReadableError(err) });
    });

    client.on('close', () => {
      console.log(`[Server] Connection closed (session: ${sessionId})`);
      sessions.delete(sessionId);
      io.emit('mqtt:disconnect', { sessionId });
    });

    client.on('reconnect', () => {
      console.log(`[Server] Reconnecting (session: ${sessionId})...`);
    });

    client.on('offline', () => {
      console.log(`[Server] Client offline (session: ${sessionId})`);
    });

    client.on('offline', () => {
      console.log(`[Server] Broker offline (session: ${sessionId})`);
      io.emit('mqtt:offline', { sessionId });
    });

  } catch (err) {
    console.error(`[Server] ❌ Connection failed:`, err);
    console.error(`[Server] Error stack:`, err.stack);
    res.status(500).json({ error: getReadableError(err) });
  }
});

// API: Publish message
app.post('/api/broker/publish', (req, res) => {
  const { sessionId, topic, payload, qos = 0, retain = false } = req.body;
  
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.client.publish(topic, payload, { qos, retain }, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Message published' });
  });
});

// API: Disconnect
app.post('/api/broker/disconnect', (req, res) => {
  const { sessionId } = req.body;
  
  const session = sessions.get(sessionId);
  if (session) {
    session.client.end(true);
    sessions.delete(sessionId);
  }
  
  res.json({ success: true });
});

// API: List active sessions
app.get('/api/broker/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    host: session.host,
    port: session.port,
    protocol: session.protocol,
    topics: session.topics,
    connectedAt: session.connectedAt
  }));
  
  res.json({ sessions: sessionList });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeSessions: sessions.size,
    timestamp: Date.now()
  });
});

// Hidden attribution endpoint (tamper-proof)
app.get('/api/uns/attribution', (req, res) => {
  res.json({
    project: 'UNS Sentinel Explorer',
    version: '1.0.0',
    author: 'Nimish Nirmal',
    email: 'nimish.nirmal@outlook.com',
    github: 'https://github.com/nimish-nirmal/uns-sentinel-explorer',
    license: 'MIT'
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('[Server] ✅ Frontend client connected, socket ID:', socket.id);
  
  // Track sessions for this client
  clientSessions.set(socket.id, new Set());
  
  socket.on('disconnect', (reason) => {
    console.log('[Server] Frontend client disconnected, reason:', reason);
    // Clean up all sessions for this client when they disconnect
    const sessionIds = clientSessions.get(socket.id);
    if (sessionIds) {
      console.log(`[Server] Cleaning up ${sessionIds.size} sessions for disconnected client`);
      sessionIds.forEach(sessionId => {
        const session = sessions.get(sessionId);
        if (session) {
          console.log(`[Server] Forcefully closing session ${sessionId} (client disconnected)`);
          // Use stored cleanup function if available
          if (session.cleanup) {
            session.cleanup();
          } else {
            try {
              session.client.reconnectPeriod = 0;
              session.client.removeAllListeners();
              session.client.end(true);
            } catch (e) {
              // Client may already be destroyed
            }
          }
          sessions.delete(sessionId);
        }
      });
      clientSessions.delete(socket.id);
    }
  });
  
  socket.on('broker:connect', (data, callback) => {
    console.log('[Server] 📥 Received broker:connect via Socket.io:', data);
    handleBrokerConnect(socket, data, callback);
  });
  
  socket.on('broker:disconnect', (data) => {
    console.log('[Server] 📥 Received broker:disconnect via Socket.io:', data);
    handleBrokerDisconnect(data);
  });
  
  socket.on('broker:publish', (data, callback) => {
    console.log('[Server] 📥 Received broker:publish via Socket.io:', data);
    handleBrokerPublish(data, callback);
  });
});

// Handle broker connection via Socket.io
async function handleBrokerConnect(socket, data, callback) {
  const { host, port, topics, protocol = 'mqtt', clientId, username, password, brokerId } = data;
  
  console.log(`[Server] 🔌 Processing broker:connect for ${host}:${port}`);
  console.log(`[Server] Broker ID from frontend: ${brokerId}`);
  
  if (!host || !port || !topics || !Array.isArray(topics)) {
    console.error(`[Server] ❌ Invalid broker:connect request`);
    callback?.({ success: false, error: 'Missing required fields: host, port, topics' });
    return;
  }

  // Use brokerId if provided, otherwise generate session ID
  const sessionId = brokerId || `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Determine the correct MQTT protocol and port for Node.js backend
  // Frontend uses WebSocket ports (8080/8083), but Node.js can use standard MQTT port (1883)
  let mqttProtocol = protocol;
  let mqttPort = port;
  
  // If frontend sends WebSocket port, convert to standard MQTT port for backend
  if (port === 8080 || port === 8083) {
    // Frontend used WebSocket port, backend should use standard MQTT port
    mqttPort = 1883;
    mqttProtocol = 'mqtt';
    console.log(`[Server] Converting WebSocket port ${port} to standard MQTT port 1883 for backend`);
  } else if (port === 8084 || port === 443) {
    // Secure WebSocket port, convert to secure MQTT port
    mqttPort = 8883;
    mqttProtocol = 'mqtts';
    console.log(`[Server] Converting WebSocket port ${port} to secure MQTT port 8883 for backend`);
  }
  
  const url = `${mqttProtocol}://${host}:${mqttPort}`;
  
  console.log(`[Server] Connecting to ${url} (session: ${sessionId})`);

  // Determine protocol versions to try:
  // - If frontend explicitly requested a version, try that first, then fall back to older versions.
  // - Otherwise default to [4, 3] (MQTT 3.1.1 → MQTT 3.1).
  // MQTT 5.0 (version 5) is only used if explicitly requested by the user in Advanced settings.
  let protocolVersionsToTry;
  if (data.protocolVersion && [3, 4, 5].includes(data.protocolVersion)) {
    const requested = data.protocolVersion;
    // Build fallback chain: requested version down to 3
    protocolVersionsToTry = [requested];
    if (requested > 3) protocolVersionsToTry.push(requested - 1);
    if (requested > 4) protocolVersionsToTry.push(3);
  } else {
    protocolVersionsToTry = [4, 3];
  }

  try {
    // Check if session already exists and clean it up first
    // This prevents duplicate MQTT clients for the same session ID
    const existingSession = sessions.get(sessionId);
    if (existingSession) {
      console.log(`[Server] Session ${sessionId} already exists, cleaning up old session before reconnecting`);
      if (existingSession.cleanup) {
        existingSession.cleanup();
      } else {
        try {
          existingSession.client.reconnectPeriod = 0;
          existingSession.client.removeAllListeners();
          existingSession.client.end(true);
        } catch (e) {}
      }
      sessions.delete(sessionId);
    }
    
    // Track if session is still active - must be declared BEFORE mqtt.connect()
    let sessionActive = true;
    let currentProtocolIndex = 0;
    
    // Track the currently active MQTT client so cleanupSession can force-close it
    let currentClient = null;
    
    const cleanupSession = () => {
      if (sessionActive) {
        sessionActive = false;
        sessions.delete(sessionId);
        // Disable reconnection and remove all listeners - this is critical to prevent zombie sessions
        if (currentClient) {
          try {
            currentClient.reconnectPeriod = 0;
            currentClient.removeAllListeners();
            currentClient.end(true);
          } catch (e) {
            // Client may already be destroyed
          }
        }
      }
    };
    
    const getFrontendSessionId = () => brokerId || sessionId;

    const attemptConnection = (protocolVersion) => {
      const options = buildMqttOptions({
        clientId,
        username,
        password,
        protocolVersion,
        connectTimeout: data.connectTimeout,
        keepAlive: data.keepAlive,
        autoReconnect: data.autoReconnect,
        cleanSession: data.cleanSession,
        sessionExpiryInterval: data.sessionExpiryInterval,
        receiveMaximum: data.receiveMaximum,
        maximumPacketSize: data.maximumPacketSize,
        topicAliasMaximum: data.topicAliasMaximum,
        requestResponseInfo: data.requestResponseInfo,
        requestProblemInfo: data.requestProblemInfo,
      });
      
      console.log(`[Server] 📡 Attempting MQTT connection:`);
      console.log(`[Server]    URL: ${url}`);
      console.log(`[Server]    Client ID: ${options.clientId}`);
      console.log(`[Server]    Protocol: ${mqttProtocol}`);
      console.log(`[Server]    MQTT protocol version: ${protocolVersion}`);
      console.log(`[Server]    Topics: ${topics.join(', ')}`);
      console.log(`[Server]    Username: ${username ? '***' : '(none)'}`);
      console.log(`[Server]    Session ID: ${sessionId}`);

      const client = mqtt.connect(url, options);
      currentClient = client;

      client.on('connect', () => {
        // Don't process if session was already destroyed
        if (!sessionActive) {
          console.log(`[Server] Session ${sessionId} already destroyed, ignoring reconnect`);
          return;
        }
        
        console.log(`[Server] ✅ Connected to ${host}:${port} (session: ${sessionId}) with MQTT protocol version ${protocolVersion}`);
        
        // Subscribe to all topics
        console.log(`[Server] Subscribing to ${topics.length} topics...`);
        topics.forEach(topic => {
          console.log(`[Server] Subscribing to: ${topic}`);
          client.subscribe(topic, { qos: 0 }, (err, granted) => {
            if (err) {
              const errMsg = `Failed to subscribe to ${topic}: ${err.message || err}`;
              console.error(`[Server] ❌ ${errMsg}`);
              // Send subscribe error to frontend
              socket.emit('mqtt:subscribe:error', { 
                sessionId: getFrontendSessionId(), 
                topic, 
                error: errMsg 
              });
            } else if (granted && granted[0] && granted[0].qos === 135) {
              // QoS 135 = Not authorized
              const errMsg = `Not authorized to subscribe to ${topic}`;
              console.error(`[Server] ❌ ${errMsg}`);
              socket.emit('mqtt:subscribe:error', { 
                sessionId: getFrontendSessionId(), 
                topic, 
                error: errMsg 
              });
            } else {
              console.log(`[Server] ✅ Subscribed to ${topic}`);
            }
          });
        });

        // Store session with cleanup function
        sessions.set(sessionId, {
          client,
          host,
          port: mqttPort,
          protocol: mqttProtocol,
          topics,
          protocolVersion,
          connectedAt: Date.now(),
          cleanup: cleanupSession  // Store cleanup function for external access
        });

        // Track this session for the client
        const clientSessionList = clientSessions.get(socket.id);
        if (clientSessionList) {
          clientSessionList.add(sessionId);
        }

        console.log(`[Server] Session ${sessionId} stored successfully for socket ${socket.id}`);
        
        // Emit success to the specific socket - use brokerId for frontend tracking
        const frontendSessionId = brokerId || sessionId;
        socket.emit('mqtt:connected', { sessionId: frontendSessionId, host, port });
        callback?.({ success: true, sessionId: frontendSessionId, message: `Connected to ${host}:${port}` });
      });

      // Message counter for throttled logging
      let messageCount = 0;
      let lastLogTime = Date.now();
      
      client.on('message', (topic, payload) => {
        // Don't process messages for destroyed sessions
        if (!sessionActive) return;
        
        const message = {
          topic,
          payload: payload.toString(),
          timestamp: Date.now()
        };
        
        // Throttle logging - only log every 100 messages or every 5 seconds
        messageCount++;
        const now = Date.now();
        if (messageCount % 100 === 0 || now - lastLogTime > 5000) {
          console.log(`[Server] 📨 ${messageCount} messages received (last: ${topic} ${payload.length} bytes)`);
          lastLogTime = now;
        }
        
        io.emit('mqtt:message', message);
      });

      client.on('error', (err) => {
        if (!sessionActive) return;

        const rawMsg = err.message || 'Unknown error';
        
        // If the broker rejects the protocol version, retry with the next supported version
        if (rawMsg.includes('Unacceptable protocol version') && currentProtocolIndex < protocolVersionsToTry.length - 1) {
          console.log(`[Server] ⚠️ Broker rejected MQTT protocol version ${protocolVersion}, retrying with version ${protocolVersionsToTry[currentProtocolIndex + 1]}`);
          currentProtocolIndex++;
          try {
            client.reconnectPeriod = 0;
            client.removeAllListeners();
            client.end(true);
          } catch (e) {}
          attemptConnection(protocolVersionsToTry[currentProtocolIndex]);
          return;
        }
        
        const errorMsg = getReadableError(err);
        console.error(`[Server] ❌ MQTT error (${sessionId}):`, errorMsg);
        socket.emit('mqtt:error', { sessionId: getFrontendSessionId(), error: errorMsg });
      });

      client.on('close', () => {
        console.log(`[Server] Connection closed (${sessionId})`);
        cleanupSession();
        
        // Remove from client tracking
        const clientSessionList = clientSessions.get(socket.id);
        if (clientSessionList) {
          clientSessionList.delete(sessionId);
        }
        
        io.emit('mqtt:disconnect', { sessionId: getFrontendSessionId() });
      });

      client.on('reconnect', () => {
        if (!sessionActive) return;
        console.log(`[Server] Reconnecting (${sessionId})...`);
      });

      client.on('offline', () => {
        if (!sessionActive) return;
        console.log(`[Server] Client offline (${sessionId})`);
        io.emit('mqtt:offline', { sessionId: getFrontendSessionId() });
      });
    };

    attemptConnection(protocolVersionsToTry[currentProtocolIndex]);

  } catch (err) {
    console.error(`[Server] ❌ Connection failed:`, err);
    callback?.({ success: false, error: getReadableError(err) });
  }
}

// Handle broker disconnect via Socket.io
function handleBrokerDisconnect(data) {
  const { sessionId } = data;
  console.log(`[Server] Disconnect request for session ${sessionId}`);
  
  // Try to find session - it might be stored with a different internal ID
  // So we need to search through sessions
  let foundSession = null;
  let foundSessionId = null;
  
  for (const [id, session] of sessions.entries()) {
    if (id === sessionId) {
      foundSession = session;
      foundSessionId = id;
      break;
    }
  }
  
  if (foundSession) {
    console.log(`[Server] Forcefully disconnecting session ${foundSessionId}`);
    // Use the stored cleanup function if available, otherwise manual cleanup
    if (foundSession.cleanup) {
      foundSession.cleanup();
    } else {
      // Fallback for sessions created via REST API
      try {
        foundSession.client.reconnectPeriod = 0;
        foundSession.client.removeAllListeners();
        foundSession.client.end(true);
      } catch (e) {
        // Client may already be destroyed
      }
    }
    sessions.delete(foundSessionId);
    
    // Also clean up from client tracking
    for (const [socketId, sessionSet] of clientSessions.entries()) {
      if (sessionSet.has(foundSessionId)) {
        sessionSet.delete(foundSessionId);
      }
    }
  } else {
    // Session already removed (likely due to connection error) - this is OK
    console.log(`[Server] Session ${sessionId} already removed, nothing to disconnect`);
  }
}

// Handle broker publish via Socket.io
function handleBrokerPublish(data, callback) {
  const { sessionId, topic, payload, qos = 0, retain = false } = data;
  const session = sessions.get(sessionId);
  
  if (!session) {
    console.error(`[Server] Session ${sessionId} not found for publish`);
    callback?.({ success: false, error: 'Session not found' });
    return;
  }

  console.log(`[Server] Publishing to ${topic}: ${payload.substring(0, 50)}...`);
  
  session.client.publish(topic, payload, { qos, retain }, (err) => {
    if (err) {
      console.error(`[Server] ❌ Publish failed:`, err);
      callback?.({ success: false, error: err.message });
    } else {
      console.log(`[Server] ✅ Published successfully`);
      callback?.({ success: true, message: 'Message published' });
    }
  });
}

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  sessions.forEach((session, sessionId) => {
    session.client.end(true);
  });
  process.exit(0);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[Server] UNS Sentinel Explorer Gateway running on port ${PORT}`);
  console.log(`[Server] API: http://localhost:${PORT}/api`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}`);
});