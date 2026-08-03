# UNS Sentinel Explorer — Node.js Backend Gateway

> **Created & maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)**

Node.js TCP Gateway that handles raw MQTT broker connections and forwards messages to the React frontend via Socket.io.

## Architecture

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        React["React Frontend<br/>(Socket.io client)"]
    end
    subgraph Server["Node.js Server"]
        Gateway["Node.js Gateway<br/>(Port 4000)"]
    end
    subgraph External["External"]
        Broker["MQTT Broker<br/>(Port 1883)"]
    end

    React <-->|"Socket.io WebSocket"| Gateway
    Gateway <-->|"TCP MQTT"| Broker
```

## Features

- **Raw TCP MQTT Support**: Connects to MQTT brokers on port 1883 (TCP) or 8883 (TLS)
- **WebSocket API**: Real-time message forwarding to React frontend via Socket.io
- **REST API**: HTTP endpoints for connection management and publishing
- **Auto-reconnection**: Automatic reconnection to MQTT brokers
- **Multiple Sessions**: Support for multiple simultaneous broker connections
- **Topic Subscription**: Wildcard topic subscription support

## Installation

```bash
cd server
npm install
```

## Usage

### Start the server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

The server will start on `http://localhost:4000`

### API Endpoints

#### POST /api/broker/connect
Connect to an MQTT broker

**Request Body:**
```json
{
  "host": "test.mosquitto.org",
  "port": 1883,
  "protocol": "mqtt",
  "topics": ["test/topic/#", "$SYS/#"],
  "clientId": "optional-client-id",
  "username": "optional-username",
  "password": "optional-password"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "sess_abc123",
  "message": "Connected to test.mosquitto.org:1883"
}
```

#### POST /api/broker/publish
Publish a message to a topic

**Request Body:**
```json
{
  "sessionId": "sess_abc123",
  "topic": "test/topic",
  "payload": "Hello MQTT",
  "qos": 0,
  "retain": false
}
```

#### POST /api/broker/disconnect
Disconnect from a broker

**Request Body:**
```json
{
  "sessionId": "sess_abc123"
}
```

#### GET /api/broker/sessions
List all active sessions

**Response:**
```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "host": "test.mosquitto.org",
      "port": 1883,
      "protocol": "mqtt",
      "topics": ["test/topic/#"],
      "connectedAt": 1234567890
    }
  ]
}
```

#### GET /api/health
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "activeSessions": 1,
  "timestamp": 1234567890
}
```

### WebSocket Events

#### Client → Server

- `broker:connect` - Connect to MQTT broker
- `broker:disconnect` - Disconnect from broker
- `broker:publish` - Publish message

#### Server → Client

- `mqtt:message` - Incoming MQTT message
  ```json
  {
    "topic": "test/topic",
    "payload": "Hello MQTT",
    "timestamp": 1234567890
  }
  ```
- `mqtt:connected` - Connection confirmed
- `mqtt:disconnect` - Connection closed
- `mqtt:error` - Error occurred
- `mqtt:offline` - Broker offline

## Configuration

Environment variables:

- `PORT` - Server port (default: 4000)

## Protocol Support

- `mqtt://` - MQTT over TCP (port 1883)
- `mqtts://` - MQTT over TLS (port 8883)
- `ws://` - MQTT over WebSocket (port 8080/8083)
- `wss://` - MQTT over Secure WebSocket (port 8084/443)

## Example Usage

```javascript
// Connect to test.mosquitto.org
const response = await fetch('http://localhost:4000/api/broker/connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'test.mosquitto.org',
    port: 1883,
    protocol: 'mqtt',
    topics: ['test/topic/#', '$SYS/#']
  })
});

const { sessionId } = await response.json();

// Listen for messages via Socket.io
const socket = io('http://localhost:4000');
socket.on('mqtt:message', (data) => {
  console.log('Received:', data.topic, data.payload);
});

// Publish a message
await fetch('http://localhost:4000/api/broker/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId,
    topic: 'test/topic',
    payload: 'Hello World',
    qos: 0,
    retain: false
  })
});
```

## Stopping the Server

Press `Ctrl+C` to gracefully shutdown. All MQTT connections will be properly closed.

---

*Documentation maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)*
