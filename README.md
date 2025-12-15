# Vexa Dashboard

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Docker](https://img.shields.io/docker/pulls/synapsr/vexa-dashboard)](https://hub.docker.com/r/synapsr/vexa-dashboard)

**100% open source** web interface for [Vexa](https://github.com/Vexa-ai/vexa) - the self-hosted meeting transcription API.

🔒 Own your data. Self-host everything. No cloud dependencies.

## 🚀 Deploy in Seconds

```bash
docker run -p 3000:3000 \
  -e VEXA_API_URL=http://your-vexa-instance:8056 \
  -e VEXA_ADMIN_API_URL=http://your-vexa-instance:8057 \
  -e VEXA_ADMIN_API_KEY=your_admin_api_key \
  synapsr/vexa-dashboard
```

**That's it!** Open [http://localhost:3000](http://localhost:3000) and start transcribing meetings.

> 💡 Only 3 environment variables needed to get started. All other settings are optional.

---

## ✨ Features

- **🎯 Join Meetings** - Send transcription bots to Google Meet and Microsoft Teams
- **📝 View Transcripts** - Browse and search through meeting transcriptions
- **⚡ Real-time** - Watch live transcriptions via WebSocket
- **🤖 AI Assistant** - Chat with your transcripts (OpenAI, Anthropic, Groq, Ollama)
- **📤 Export** - Download in TXT, JSON, SRT, or VTT formats
- **👥 User Management** - Admin dashboard for users and API tokens
- **🌙 Dark Mode** - System-aware theme switching
- **📱 Responsive** - Works on all devices

## Screenshots

*Coming soon*

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
  -e VEXA_ADMIN_API_URL=http://your-vexa-instance:8057 \
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
  -e VEXA_ADMIN_API_URL=http://your-vexa-instance:8057 \
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

- [Vexa](https://github.com/Vexa-ai/vexa) - Self-hosted meeting transcription API
