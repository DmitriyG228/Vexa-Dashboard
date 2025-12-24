# Vexa Dashboard

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Docker](https://img.shields.io/docker/pulls/synapsr/vexa-dashboard)](https://hub.docker.com/r/synapsr/vexa-dashboard)

**100% open source** web interface for [Vexa](https://github.com/Vexa-ai/vexa) - the self-hosted meeting transcription API.

🔒 Own your data. Self-host everything. No cloud dependencies.

> 📖 **Main Repository**: This is the web UI for Vexa. For the core API, deployment guides, and full documentation, see the [main Vexa repository](https://github.com/Vexa-ai/vexa).

## 🚀 Deploy in Seconds

```bash
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  synapsr/vexa-dashboard
```

**That's it!** Open [http://localhost:3000](http://localhost:3000) and start transcribing meetings.

> 💡 Only 3 environment variables needed to get started. All other settings are optional.

---

## ✨ Features

- **🎯 Join Meetings** - Send transcription bots to Google Meet and Microsoft Teams
- **⚡ Real-time Transcription** - Watch live transcriptions as they happen during the meeting (sub-second latency via WebSocket)
- **📝 View Transcripts** - Browse and search through meeting transcriptions
- **🤖 AI Assistant** - Chat with your transcripts (OpenAI, Anthropic, Groq, Ollama)
- **🔌 MCP Integration** - Easy setup for MCP-compatible agents (Claude Desktop, Cursor, etc.) to access Vexa capabilities
- **📤 Export** - Download in TXT, JSON, SRT, or VTT formats
- **👥 User Management** - Admin dashboard for users and API tokens
- **🌙 Dark Mode** - System-aware theme switching
- **📱 Responsive** - Works on all devices

## Screenshots

### Dashboard
![Dashboard](docs/screenshots/01-dashboard.png)

### Join a Meeting
![Join Meeting](docs/screenshots/02-join-meeting.png)

### Live Transcription
![Live Transcript](docs/screenshots/06-live-transcript.png)

### Meetings List
![Meetings List](docs/screenshots/07-meetings-list.png)

### Admin - User Management
![Admin Users](docs/screenshots/08-admin-users.png)

### Admin - Bots Monitoring
![Admin Bots](docs/screenshots/09-admin-bots.png)

## 🐳 Docker Deployment

### Quick Start (Recommended)

Pull and run the pre-built image:

```bash
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_URL=http://your-vexa-instance:8057 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  synapsr/vexa-dashboard
```

### With AI Assistant

Add AI-powered transcript analysis:

```bash
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  -e AI_MODEL=openai/gpt-4o \
  -e AI_API_KEY=sk-your-openai-key \
  synapsr/vexa-dashboard
```

### With Email Authentication

Enable Magic Link login with SMTP:

```bash
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  -e SMTP_HOST=smtp.resend.com \
  -e SMTP_PORT=587 \
  -e SMTP_USER=resend \
  -e SMTP_PASS=your_smtp_key \
  -e SMTP_FROM=noreply@yourdomain.com \
  synapsr/vexa-dashboard
```

### Docker Compose

```yaml
services:
  vexa-dashboard:
    image: synapsr/vexa-dashboard
    ports:
      - "3000:3000"
    environment:
      - VEXA_API_URL=http://vexa:8056
      - VEXA_ADMIN_API_URL=http://vexa:8057
      - VEXA_ADMIN_API_KEY=${VEXA_ADMIN_API_KEY}
    restart: unless-stopped
```

## 🛠️ Configuration

### Required Variables

| Variable | Description |
|----------|-------------|
| `VEXA_API_URL` | Your Vexa API URL (for meetings, transcripts, bots) |
| `VEXA_ADMIN_API_URL` | Your Vexa Admin API URL (for user management) |
| `VEXA_ADMIN_API_KEY` | Admin API key from Vexa |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_BOT_NAME` | Default name for transcription bots | `Vexa - Open Source Bot` |
| `AI_MODEL` | AI provider/model (e.g., `openai/gpt-4o`) | - |
| `AI_API_KEY` | API key for AI provider | - |
| `SMTP_HOST` | SMTP server for Magic Link auth | - |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASS` | SMTP password | - |
| `SMTP_FROM` | Sender email address | - |
| `ALLOW_REGISTRATIONS` | Allow new signups | `true` |
| `ALLOWED_EMAIL_DOMAINS` | Restrict signup domains | All |

### AI Providers

```bash
# OpenAI
AI_MODEL=openai/gpt-4o

# Anthropic Claude
AI_MODEL=anthropic/claude-sonnet-4-20250514

# Groq (fast & free)
AI_MODEL=groq/llama-3.3-70b-versatile

# Local Ollama
AI_MODEL=ollama/llama3.2
AI_BASE_URL=http://localhost:11434/v1
```

## 🔐 Authentication Modes

### Direct Login (Default)

Without SMTP configured, users authenticate with just their email (no verification). Great for development and trusted environments.

### Magic Link (with SMTP)

With SMTP configured, users receive a secure sign-in link via email. Recommended for production.

## 💻 Local Development

```bash
# Clone
git clone https://github.com/Vexa-ai/vexa-dashboard.git
cd vexa-dashboard

# Install
npm install

# Configure
cp .env.example .env.local
# Edit .env.local with your values

# Run
npm run dev
```

## 🏗️ Build from Source

```bash
# Build image
docker build -t vexa-dashboard .

# Run
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_URL=http://your-vexa-instance:8057 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  vexa-dashboard
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: shadcn/ui + Tailwind CSS
- **State**: Zustand
- **Language**: TypeScript
- **AI**: Vercel AI SDK

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.

## Related Projects

- **[Vexa](https://github.com/Vexa-ai/vexa)** - Main repository with core API, services, and documentation
  - [Deployment Guide](https://github.com/Vexa-ai/vexa/blob/main/docs/deployment.md) - Full stack deployment
  - [Vexa Lite Deployment](https://github.com/Vexa-ai/vexa/blob/main/docs/vexa-lite-deployment.md) - Single container deployment
  - [User API Guide](https://github.com/Vexa-ai/vexa/blob/main/docs/user_api_guide.md) - Complete API reference
- **[vexa-lite-deploy](https://github.com/Vexa-ai/vexa-lite-deploy)** - One-click deployment configurations for Vexa Lite

## How It Works

Vexa Dashboard connects to your Vexa API instance (self-hosted or hosted) to provide:

1. **Meeting Management** - Join Google Meet and Microsoft Teams meetings with transcription bots
2. **Real-time Transcription** - Watch live transcriptions as they happen during the meeting. Transcripts stream in real-time via WebSocket with sub-second latency, so you see what's being said as it happens.
3. **User Management** - Admin interface for managing users and API tokens
4. **AI Assistant** - Chat with your transcripts using various AI providers

The dashboard is a Next.js application that communicates with Vexa's REST and WebSocket APIs. You can deploy it alongside your Vexa instance or connect it to a remote Vexa API.

## 🤖 MCP (Model Context Protocol) Integration

Vexa provides easy MCP setup for your AI agents. Connect Claude Desktop, Cursor, or any MCP-compatible client to access Vexa's meeting transcription capabilities directly from your agent.

### Quick Setup for Claude Desktop

1. **Get your Vexa API key** from your Vexa Dashboard or API settings
2. **Open Claude Desktop Settings** → **Developer** → **Edit Config**
3. **Add MCP configuration:**

```json
{
  "mcpServers": {
    "Vexa": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.cloud.vexa.ai/mcp",
        "--header",
        "Authorization:${VEXA_API_KEY}"
      ],
      "env": {
        "VEXA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

4. **For self-hosted Vexa**, replace `https://api.cloud.vexa.ai/mcp` with your Vexa API URL (e.g., `http://localhost:8056/mcp` for Vexa Lite)
5. **Restart Claude Desktop**

Your agent can now:
- Send bots to meetings
- Get real-time transcripts
- Access meeting history
- Manage users and API tokens

> 📖 **Full MCP setup guide**: See the [Vexa MCP documentation](https://github.com/Vexa-ai/vexa/tree/main/services/mcp) for detailed instructions and advanced configuration.
