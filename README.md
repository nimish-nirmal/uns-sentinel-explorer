<p align="center">
  <img src="https://img.shields.io/badge/UNS%20Sentinel%20Explorer-MQTT%20Dashboard-22d3ee?style=for-the-badge&logo=apache-mqtt&logoColor=white" alt="UNS Sentinel Explorer" />
</p>

<p align="center">
  <a href="https://nimish-nirmal.github.io/uns-sentinel-explorer/">
    <img src="https://img.shields.io/badge/%F0%9F%9A%80%20Live%20Demo-GitHub%20Pages-34d399?style=flat-square" alt="Live Demo" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer/actions/workflows/deploy-pages.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/nimish-nirmal/uns-sentinel-explorer/deploy-pages.yml?label=Pages%20Deploy&style=flat-square&logo=github" alt="Pages Deploy" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/nimish-nirmal/uns-sentinel-explorer/ci.yml?label=CI&style=flat-square&logo=github&logoColor=white" alt="CI" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/nimish-nirmal/uns-sentinel-explorer?style=flat-square&color=8b5cf6" alt="License" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  </a>
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-18.3-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  </a>
  <a href="https://vitejs.dev/">
    <img src="https://img.shields.io/badge/Vite-5.4-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  </a>
  <a href="https://tailwindcss.com/">
    <img src="https://img.shields.io/badge/Tailwind%20CSS-3.4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer">
    <img src="https://img.shields.io/github/stars/nimish-nirmal/uns-sentinel-explorer?style=flat-square&logo=github&logoColor=white" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer/issues">
    <img src="https://img.shields.io/github/issues/nimish-nirmal/uns-sentinel-explorer?style=flat-square&logo=github" alt="Issues" />
  </a>
  <a href="https://github.com/nimish-nirmal/uns-sentinel-explorer/pulls">
    <img src="https://img.shields.io/badge/PRs-welcome-34d399?style=flat-square&logo=github" alt="PRs Welcome" />
  </a>
  <img src="https://img.shields.io/badge/MQTT-v5%20WebSocket-660066?style=flat-square&logo=apache-mqtt" alt="MQTT v5" />
  <img src="https://img.shields.io/badge/ISA--95-Hierarchical-22d3ee?style=flat-square" alt="ISA-95" />
</p>

<h1 align="center">🔭 UNS Sentinel Explorer</h1>

<p align="center">
  <strong>UNS Sentinel Explorer is an open-source, web-based dashboard built for Unified Namespace architectures.</strong><br/>
  It features an ISA-95 hierarchical topic tree, multi-broker tab management, and dynamic auto-discovery for legacy topics.<br/>
  Effortlessly inspect real-time JSON payload diffs, plot live telemetry graphs, and publish custom MQTT data streams.
</p>

<p align="center">
  <strong>Created & maintained by <a href="https://github.com/nimish-nirmal">Nimish Nirmal</a></strong>
</p>

<p align="center">
  <a href="https://nimish-nirmal.github.io/uns-sentinel-explorer/" target="_blank" style="text-decoration: none;">
    <img src="https://img.shields.io/badge/🚀_Launch_Live_Demo-Click_Here-22d3ee?style=for-the-badge&logo=github&logoColor=white" alt="Launch Live Demo" />
  </a>
</p>

> **💡 Note:** The Live Demo runs on **GitHub Pages (static hosting)** — it cannot run the Node.js backend gateway because GitHub Pages only serves static files (no server-side processes). The demo **automatically falls back to the built-in Demo Simulator**, so you can explore the full dashboard with realistic telemetry without any backend.
>
> To use **real MQTT broker connections**, run the app locally with `npm run dev:all` (starts both the frontend and the backend gateway).

---

## 📋 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🎮 Live Demo](#-live-demo)
- [🔌 Connecting to a Broker](#-connecting-to-a-broker)
- [🖥️ User Interface](#️-user-interface)
- [🏗️ Architecture](#️-architecture)
- [⚙️ Configuration](#️-configuration)
- [🛠️ Tech Stack](#️-tech-stack)
- [📦 CI/CD & GitHub Pages](#-cicd--github-pages)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features

### 1. Multi-Broker Session Tabs 🔄
Manage multiple simultaneous MQTT broker connections, each in its own tab:

- **Live status indicator** — `● LIVE` pulse when connected
- **Protocol badge** — `WSS` (secure) or `WS` (plain)
- **Multi-topic subscription rules** — subscribe to wildcard patterns concurrently:
  ```
  Enterprise/Site1/Area1/Line1/Cell1/#
  legacy/sensors/+/temp
  $SYS/#
  ```
- Per-session stats isolated in the health panel

### 2. Dynamic Topic Tree Navigator (ISA-95 + Legacy) 🌳
Auto-builds a hierarchical tree by parsing topic strings on `/`:

| Node Type | Example | Color | Icon |
| --------- | ------- | ----- | ---- |
| **ISA-95** | `Enterprise/Site1/Area1/Line1/Cell1` | 🩵 Cyan | 🏢 |
| **Legacy** | `legacy/sensors/sensor-01/temp` | 🟢 Emerald | 📦 |
| **$SYS** | `$SYS/broker/uptime` | 🟡 Amber | ⚙️ |

- **Live search/filter** — instantly isolate matching topics by name, full path, or payload values
- Leaf timestamps show last update (`2s ago`)

### 3. Real-Time Payload Diff Viewer 📝
- **Monaco Diff Editor** highlights added/removed/changed keys between updates
- **View formats**: `JSON` | `TEXT` | `CSV` — switch between structured, flat key-value, or tabular views
- Custom dark theme with cyan/emerald token colors matching the dashboard
- **Internal scroll only** — long payloads scroll inside the editor while numeric attribute cards stay pinned

### 4. Numeric Attributes & Telemetry Trends 📈
- **Numeric attributes** are extracted from any payload — including values nested inside arrays/objects (e.g. `d[0].value`, `sensors[2].temp`)
- Click attribute chips in the center panel to **select what plots on Telemetry Trends**
- The right-panel **Telemetry Trends** chart is driven entirely by your center-panel selection
- Multiple attributes overlaid with distinct colors
- **Live PIP window** — pop out the chart to a standalone window that **updates in real-time** as data streams in

### 5. Namespace Health & Analytics 📊
- **Messages received** + total bytes
- **Throughput** (msg/sec) with live sparkline
- **Topic tree node** / payload counts
- **Active subscription rules** with QoS badges

### 6. MQTT Payload Publisher 📤
- Target topic path with autocomplete from tree
- JSON/Text payload editor
- **Retain checkbox — default ON for UNS**
- QoS selector (0, 1, 2)

### 7. Saved Brokers & Workspace 💾
- Persist profiles to `localStorage`
- One-click **Launch Session**, edit, or delete
- **Export / Import** all profiles as a JSON workspace file

### 8. Demo Simulator Mode 🧪
- Click **"Launch Demo Simulator"** — no broker needed
- Streams realistic ISA-95 + legacy telemetry entirely in-browser
- Perfect for offline UI testing / showcases

### 9. Secure Connection Form 🔐
- **Password eye toggle** — show/hide password with a click
- TLS/Certificate options for secure brokers (WSS/MQTTS)
- Protocol auto-port selection

---

## 🚀 Quick Start

### Prerequisites
- **Node.js ≥ 18** (tested on v20)
- npm or yarn

### Install & Run

```bash
# Clone the repo
git clone https://github.com/nimish-nirmal/uns-sentinel-explorer.git
cd uns-sentinel-explorer

# Install dependencies
npm install

# Start the dev server
npm run dev
# → http://localhost:5173/uns-sentinel-explorer/

# Production build
npm run build

# Preview the production build locally
npm run preview
```

### Using Node installed outside PATH (like this workspace)

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm run dev
```

---

## 🎮 Live Demo

Try it instantly on **GitHub Pages**:

<p align="center">
  <a href="https://nimish-nirmal.github.io/uns-sentinel-explorer/" target="_blank">
    <img src="https://img.shields.io/badge/%F0%9F%9A%80%20Live%20Demo-https%3A%2F%2Fnimish--nirmal%2Egithub%2Eio%2Funs--sentinel--explorer%2F-34d399?style=for-the-badge" alt="Live Demo" />
  </a>
</p>

> **💡 Tip:** Click **"Launch Demo Simulator"** in the header to see the full dashboard populated with realistic telemetry instantly.

---

## 🔌 Connecting to a Broker

Click **`+ Add Session`** in the top tab bar:

| Field            | Example                | Notes                          |
| ---------------- | ---------------------- | ------------------------------ |
| **Protocol**     | `WSS` (default) / `WS` | Auto-adjusts default port      |
| **Host**         | `broker.emqx.io`       | Public test broker             |
| **Port**         | `8084` (WSS) / `8083` (WS) | Auto-set by protocol      |
| **Session Label**| `My Factory UNS`       | Shown on the session tab       |
| **Client ID**    | *(auto-generated)*     | Optional — leave blank for random |
| **Username**     | *(optional)*           | For authenticated brokers      |
| **Password**     | *(optional, eye toggle)* | For authenticated brokers    |
| **Subscription Patterns** | One per line    | Wildcards supported (`#`, `+`) |
| **QoS**          | `0 / 1 / 2`            | Applied to all patterns        |
| **Save to local storage** | ✅ checked      | Persists profile for later     |

**Test brokers you can use:**

| Broker            | WSS Port | WS Port |
| ----------------- | -------- | ------- |
| `broker.emqx.io`  | 8084     | 8083    |
| `test.mosquitto.org` | 8081  | 8080    |
| `broker.hivemq.com`  | 8884  | 8000    |

---

## 🖥️ User Interface

```mermaid
flowchart LR
    subgraph TopBar["Top Bar"]
        Title["UNS Sentinel Explorer · by Nimish Nirmal"]
        Links["📖 Docs · 🐙 GitHub"]
    end

    subgraph SessionBar["Session Tab Bar"]
        Tabs["[Session 1 ● LIVE] [Session 2] [+ Add Session]"]
        Actions["Publish · Saved Brokers · Active Sessions"]
    end

    subgraph Main["Main Layout"]
        subgraph Left["Left Panel (30%)"]
            Tree["🌳 Namespace Tree<br/>ISA-95 / Legacy / $SYS<br/>Search + Filter"]
        end
        subgraph Center["Center Panel (45%)"]
            Payload["📝 Payload Diff Viewer<br/>JSON | TEXT | CSV formats<br/>Monaco internal scroll"]
            Numeric["Numeric Attributes chips<br/>→ drives Telemetry Trends"]
            Chart["📈 Live streaming chart"]
        end
        subgraph Right["Right Panel (25%)"]
            Health["📊 Namespace Health<br/>KPIs · Throughput · Sparkline"]
            Trends["Telemetry Trends<br/>driven by center selection"]
            Pip["↗ Live PIP pop-out window"]
        end
    end

    TopBar --> SessionBar --> Main
    Left --> Center
    Center --> Right
```

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph Frontend["React Frontend (src/)"]
        App["App.tsx<br/>Session orchestration<br/>Shared telemetry selection state"]
        SessionBar["SessionBar.tsx"]
        TopicTree["TopicTree.tsx"]
        PayloadViewer["PayloadViewer.tsx<br/>Diff + Numeric attributes"]
        HealthPanel["HealthPanel.tsx<br/>KPIs + Telemetry Trends + PIP"]
        Modals["Modals<br/>BrokerConfig · SavedBrokers · Publish · ActiveSessions"]
    end

    subgraph Engine["Engine Layer (src/engine/)"]
        MqttEngine["mqttEngine.ts<br/>Socket.io client · 20 FPS batching<br/>Session lifecycle"]
        TopicTreeEngine["topicTree.ts<br/>ISA-95 tree builder<br/>Numeric series extraction"]
        Simulator["simulator.ts<br/>Offline demo telemetry"]
    end

    subgraph Backend["Backend Gateway (server/)"]
        Gateway["Node.js Gateway<br/>Socket.io + MQTT bridge"]
    end

    subgraph Broker["External"]
        MQTT["MQTT Broker<br/>(ws/wss)"]
    end

    MQTT <-->|"TCP MQTT"| Gateway
    Gateway <-->|"Socket.io WebSocket"| MqttEngine
    MqttEngine -->|"batched messages ≤20 FPS"| App
    App --> TopicTree
    App --> PayloadViewer
    App --> HealthPanel
    App --> Modals
    TopicTreeEngine --> PayloadViewer
    TopicTreeEngine --> HealthPanel
    Simulator -->|"applyMessageBatch"| App
```

### Data Flow

```mermaid
sequenceDiagram
    participant Broker as MQTT Broker
    participant Gateway as Node.js Gateway
    participant Engine as MqttEngine
    participant App as React App
    participant Tree as TopicTree
    participant Payload as PayloadViewer
    participant Health as HealthPanel

    Broker->>Gateway: MQTT message (TCP)
    Gateway->>Engine: Socket.io mqtt:message
    Engine->>Engine: Batch buffer (50ms / 500 max)
    Engine->>App: onBatch (≤20 FPS)
    App->>Tree: upsertTopicNode(payload)
    Tree->>Payload: selectedNode payload + previousPayload
    Tree->>Health: collectNumericLeafs()
    Payload->>Health: selectedTelemetryKeys (shared state)
    Health->>Health: render Telemetry Trends
    Health-->>PIP: live-update popup window
```

### Performance Buffering
Incoming MQTT packets are collected in an **in-memory batching array** and flushed to React state at **max 20 FPS** (50ms window). A batch cap of 500 messages protects memory on extreme loads — preventing UI freezes during high-rate bursts.

### Sparkplug B / Binary Handling
Payloads are decoded in order:
1. **JSON parse** — standard UTF-8 JSON payloads
2. **Printable string** — fallback for plain text
3. **Raw hex** — binary/protobuf (e.g. Sparkplug B) → `0x…`

---

## ⚙️ Configuration

### Vite (`vite.config.ts`)
- `base: '/uns-sentinel-explorer/'` — GitHub Pages subpath
- Code-split `manualChunks`: React, MQTT, Monaco, Recharts

### Tailwind (`tailwind.config.js`)
- Base: `slate-950` background
- Accents: cyan (`#22d3ee`), emerald (`#34d399`)

### Environment Variables
| Variable | Purpose |
| -------- | ------- |
| `VITE_GATEWAY_URL` | Backend gateway URL (defaults to `http://localhost:4000`) |

### localStorage Keys
| Key | Purpose |
| --- | ------- |
| `uns-sentinel-explorer:brokers` | Saved broker profiles |

---

## 🛠️ Tech Stack

| Layer      | Library                          | Version |
| ---------- | -------------------------------- | ------- |
| Framework  | React / Vite / TypeScript        | 18.3 / 5.4 / 5.6 |
| Styling    | Tailwind CSS                     | 3.4     |
| MQTT       | `mqtt` (WebSocket, v5 protocol)  | 5.10    |
| Diff Viewer| `@monaco-editor/react`           | 4.6     |
| Charts     | `recharts`                       | 2.15    |
| Icons      | `lucide-react`                   | 0.441   |

---

## 📦 CI/CD & GitHub Pages

Two workflows run automatically on every push to `main`:

### 1. CI (`ci.yml`)
Type-checks with `tsc --noEmit` and builds the production bundle. Badge:
[![CI](https://img.shields.io/github/actions/workflow/status/nimish-nirmal/uns-sentinel-explorer/ci.yml?label=CI&style=flat-square&logo=github&logoColor=white)](https://github.com/nimish-nirmal/uns-sentinel-explorer/actions/workflows/ci.yml)

### 2. Deploy to GitHub Pages (`deploy-pages.yml`)
Builds and deploys the `dist/` directory to GitHub Pages. Requires Pages configured to **"GitHub Actions"** as the source in repo Settings → Pages. Badge:
[![Pages Deploy](https://img.shields.io/github/actions/workflow/status/nimish-nirmal/uns-sentinel-explorer/deploy-pages.yml?label=Pages%20Deploy&style=flat-square&logo=github)](https://github.com/nimish-nirmal/uns-sentinel-explorer/actions/workflows/deploy-pages.yml)

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feat/amazing-feature`
3. **Commit** your changes: `git commit -m 'feat: add amazing feature'`
4. **Push** to the branch: `git push origin feat/amazing-feature`
5. Open a **Pull Request**

Please ensure your PR:
- ✅ Passes `npm run build` and `npx tsc --noEmit`
- ✅ Follows the existing code style
- ✅ Updates the README if adding features

---

## 📄 License

**MIT License** — see [LICENSE](LICENSE).

Copyright © 2026 [Nimish Nirmal](https://github.com/nimish-nirmal)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/nimish-nirmal">Nimish Nirmal</a> for the Unified Namespace community · ⭐ Star it if you find it useful!
</p>