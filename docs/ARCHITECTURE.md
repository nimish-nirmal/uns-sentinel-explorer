# UNS Sentinel Explorer — Architecture & Migration Guide

> **Created & maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)**

---

## Current Architecture: Backend Gateway Pattern

### Why WebSocket?

**Browser Limitations:**
- Browsers cannot make raw TCP connections (required for standard MQTT on ports 1883/8883)
- Browsers only support WebSocket connections
- Therefore, all MQTT connections from browsers MUST use WebSocket (ws:// or wss://)

**Current Implementation:**

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        React["React Frontend<br/>(Socket.io client)"]
    end
    subgraph Server["Node.js Server"]
        Gateway["Node.js Gateway<br/>(server/)"]
    end
    subgraph External["External"]
        Broker["MQTT Broker"]
    end

    React <-->|"Socket.io WebSocket"| Gateway
    Gateway <-->|"TCP MQTT"| Broker
```

**Why a Backend Gateway?**
1. **Protocol Translation**: Converts WebSocket (from browser) ↔ TCP MQTT (to broker)
2. **Session Management**: Centralized connection pooling and lifecycle management
3. **Security**: Credentials never exposed to browser; backend handles authentication
4. **Reliability**: Auto-reconnection, message queuing, connection health monitoring
5. **Scalability**: Multiple browser tabs can share MQTT connections

### Current Data Flow

```mermaid
sequenceDiagram
    participant FE as React Frontend
    participant BE as Node.js Gateway
    participant Broker as MQTT Broker

    FE->>BE: socket.emit('broker:connect', config)
    BE->>Broker: mqtt.connect(url)
    Broker-->>BE: client.on('message')
    BE-->>FE: io.emit('mqtt:message')
```

---

## Frontend Architecture

```mermaid
flowchart TD
    subgraph App["App.tsx — Orchestration"]
        State["Session state<br/>Selected node<br/>Selected telemetry keys (shared)"]
    end

    subgraph Components["Components"]
        SessionBar["SessionBar.tsx<br/>Tabs + global actions"]
        TopicTree["TopicTree.tsx<br/>ISA-95 / Legacy / $SYS tree"]
        PayloadViewer["PayloadViewer.tsx<br/>Diff (JSON/TEXT/CSV)<br/>Numeric attributes chips<br/>Live chart"]
        HealthPanel["HealthPanel.tsx<br/>KPIs · Sparkline<br/>Telemetry Trends<br/>Live PIP window"]
        Modals["Modals<br/>BrokerConfig · SavedBrokers<br/>Publish · ActiveSessions"]
    end

    subgraph Engine["Engine Layer"]
        MqttEngine["mqttEngine.ts<br/>Socket.io · 20 FPS batching"]
        TopicTreeEngine["topicTree.ts<br/>Tree builder · extractNumericSeries"]
        Simulator["simulator.ts<br/>Offline demo"]
    end

    App --> Components
    App --> Engine
    PayloadViewer -->|"selectedKeys (shared state)"| HealthPanel
    TopicTreeEngine --> PayloadViewer
    TopicTreeEngine --> HealthPanel
```

### Key Data Flows

#### 1. Message Ingestion & Batching

```mermaid
flowchart LR
    Broker["MQTT Broker"] -->|"mqtt:message"| Gateway["Node.js Gateway"]
    Gateway -->|"Socket.io"| Engine["MqttEngine"]
    Engine -->|"batch buffer<br/>(50ms / 500 max)"| App["App.tsx"]
    App -->|"upsertTopicNode"| Tree["TopicTree"]
    Tree -->|"selectedNode"| Payload["PayloadViewer"]
    Tree -->|"collectNumericLeafs"| Health["HealthPanel"]
```

#### 2. Numeric Attribute Selection → Telemetry Trends

```mermaid
flowchart LR
    Payload["PayloadViewer<br/>Numeric attributes chips"] -->|"onToggleKey"| App["App.tsx<br/>selectedTelemetryKeys"]
    App -->|"selectedTelemetryKeys"| Health["HealthPanel"]
    Health -->|"suffix match<br/>(d[0].value, temp, etc.)"| Series["Visible series"]
    Series -->|"Recharts"| Chart["Telemetry Trends chart"]
    Series -->|"SVG render"| Pip["Live PIP window<br/>(auto-updates)"]
```

#### 3. Payload Diff Formats

```mermaid
flowchart LR
    Node["Selected UNSTreeNode"] -->|"payload / previousPayload"| Format["Format selector"]
    Format -->|"JSON"| Json["prettyJSON()"]
    Format -->|"TEXT"| Text["flattenPayload() → key: value"]
    Format -->|"CSV"| Csv["flattenPayload() → header,row"]
    Json --> Monaco["Monaco Editor / DiffEditor"]
    Text --> Monaco
    Csv --> Monaco
```

---

## Alternative: Paho MQTT (Direct Browser Connection)

### What is Paho MQTT?

[Paho MQTT](https://www.npmjs.com/package/paho-mqtt) is an MQTT client library that runs **directly in the browser** using WebSocket connections. It eliminates the need for a backend gateway.

**Paho MQTT Architecture:**

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        React["React Frontend<br/>(Paho MQTT client)"]
    end
    subgraph External["External"]
        Broker["MQTT Broker"]
    end

    React <-->|"MQTT over WebSocket"| Broker
```

### Paho MQTT Benefits

✅ **Simpler Architecture**: No backend gateway needed
✅ **Lower Latency**: Direct connection to broker
✅ **Reduced Server Load**: No Node.js gateway required
✅ **Easier Deployment**: Single frontend application
✅ **Standard Protocol**: Uses MQTT over WebSocket (ws://broker:8083/mqtt)

### Paho MQTT Limitations

❌ **Browser-Only**: Only works with WebSocket-enabled brokers
❌ **No TCP MQTT**: Cannot connect to standard ports (1883, 8883)
❌ **Credential Exposure**: Username/password visible in browser DevTools
❌ **No Centralized Logging**: Harder to debug across multiple clients
❌ **Connection Limits**: Each browser tab = separate MQTT connection
❌ **CORS Issues**: Broker must allow WebSocket connections from your domain

### Paho MQTT Implementation Example

```typescript
import Paho from 'paho-mqtt';

// Connect to broker
const client = new Paho.Client('broker.emqx.io', 8083, 'client-id');

client.connect({
  onSuccess: () => {
    console.log('Connected');
    client.subscribe('test/topic/#');
  },
  onFailure: (err) => {
    console.error('Connection failed:', err);
  }
});

// Receive messages
client.onMessageArrived = (message) => {
  console.log('Message:', message.destinationName, message.payloadString);
};

// Publish message
const msg = new Paho.Message('Hello World');
msg.destinationName = 'test/topic';
client.send(msg);
```

---

## Comparison Matrix

| Feature | Current (Gateway) | Paho MQTT (Direct) |
|---------|-------------------|-------------------|
| **Architecture** | Frontend → Backend → Broker | Frontend → Broker |
| **Protocol** | Socket.io + WebSocket | MQTT over WebSocket |
| **TCP MQTT Support** | ✅ Yes (via backend) | ❌ No |
| **WebSocket MQTT** | ✅ Yes | ✅ Yes |
| **Secure WebSocket** | ✅ Yes | ✅ Yes |
| **Credential Security** | ✅ Hidden in backend | ⚠️ Visible in browser |
| **Connection Sharing** | ✅ Multiple tabs share | ❌ Each tab separate |
| **Offline Buffering** | ✅ Backend can queue | ❌ No buffering |
| **Debugging** | ✅ Centralized logs | ⚠️ Distributed |
| **Deployment** | ❌ Requires Node.js server | ✅ Pure frontend |
| **Latency** | ⚠️ Extra hop | ✅ Direct |
| **Scalability** | ✅ Backend manages pool | ❌ N connections for N tabs |

---

## Recommendation

### Keep Current Architecture (Backend Gateway) If:
- ✅ You need to support standard MQTT (TCP) connections
- ✅ Security is critical (credentials must stay server-side)
- ✅ You want centralized logging and monitoring
- ✅ Multiple browser tabs need to share connections
- ✅ You need offline message buffering

### Migrate to Paho MQTT If:
- ✅ You only need WebSocket connections
- ✅ Simplicity is preferred over advanced features
- ✅ You want to eliminate the Node.js backend
- ✅ Credential security is not a concern
- ✅ Each tab can have its own connection

---

## Migration Path to Paho MQTT

If you want to migrate to Paho MQTT, here's the plan:

### Step 1: Install Paho MQTT
```bash
npm install paho-mqtt
```

### Step 2: Create Paho MQTT Engine
Create `src/engine/pahoMqttEngine.ts`:
```typescript
import Paho from 'paho-mqtt';

export class PahoMqttEngine {
  private clients = new Map<string, Paho.Client>();
  
  connect(config: BrokerConfig): void {
    const client = new Paho.Client(config.host, config.port, config.clientId);
    
    client.connect({
      userName: config.username,
      password: config.password,
      useSSL: config.protocol === 'wss' || config.protocol === 'mqtts',
      onSuccess: () => {
        // Subscribe to topics
        config.subscriptions.forEach(sub => {
          client.subscribe(sub.pattern);
        });
      }
    });
    
    client.onMessageArrived = (msg) => {
      // Handle message
    };
    
    this.clients.set(config.id, client);
  }
}
```

### Step 3: Update UI Components
- Replace Socket.io events with Paho callbacks
- Remove backend dependency
- Update connection status handling

### Step 4: Remove Backend
- Delete `server/` directory
- Remove Socket.io dependency
- Update package.json

---

## Current Implementation Status

### ✅ Completed
- Backend gateway with comprehensive logging
- Frontend WebSocket connection via Socket.io
- DOM warning fixed (password field now in form)
- Detailed connection debugging logs added
- Password eye toggle in connection form
- Payload diff formats (JSON / TEXT / CSV)
- Numeric attribute selection → Telemetry Trends
- Live PIP window (auto-updating SVG chart)
- Internal scroll for payload editor (numeric cards stay pinned)
- Infinite update loop fixed in PayloadViewer
- Docs + GitHub links in top bar

### 🔄 In Progress
- Testing MQTT connections with new logs
- Verifying message flow end-to-end

### ⏭️ Next Steps
1. Test connection with logs enabled
2. Verify message subscriptions work
3. Decide on Paho MQTT migration (if desired)
4. Implement chosen architecture

---

## Questions to Answer Before Migration

1. **Do you need TCP MQTT support?** (port 1883/8883)
   - If YES → Keep current architecture
   - If NO → Paho MQTT is viable

2. **Is credential security important?**
   - If YES → Keep current architecture
   - If NO → Paho MQTT is viable

3. **Do you need centralized logging?**
   - If YES → Keep current architecture
   - If NO → Paho MQTT is viable

4. **Do you want to eliminate the Node.js server?**
   - If YES → Migrate to Paho MQTT
   - If NO → Keep current architecture

---

## Conclusion

**Current architecture is recommended for production use** because:
- Better security (credentials never leave server)
- Supports all MQTT protocols (TCP + WebSocket)
- Centralized logging and monitoring
- Connection pooling and resource management
- Offline message buffering

**Paho MQTT is suitable for:**
- Quick prototypes
- Development/testing environments
- Applications where security is not critical
- Scenarios where deployment simplicity is paramount

The current implementation with enhanced logging will help you debug connection issues. Once you confirm MQTT is working, you can decide if migration to Paho MQTT is worth the tradeoffs.

---

*Documentation maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)*