# Voice Code

A real-time voice-to-code IDE powered by Grok AI that enables developers to write code using voice commands.

## Features

- Real-time voice transcription using Grok API
- Support for English and Russian languages
- Visual microphone indicator with speech detection
- WebSocket-based real-time communication
- React.js frontend with Python Flask backend

## Technology Stack

- **Frontend**: React.js with Vite
- **Backend**: Python Flask with SocketIO
- **AI**: Grok API (x.ai) with Whisper transcription
- **Real-time Communication**: WebSocket

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- Grok API key from x.ai

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create `.env` file in project root:
```
OPENAI_API_KEY=your_grok_api_key_here
```

5. Run backend:
```bash
python app.py
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Run frontend:
```bash
npm run dev
```

## Usage

1. Open browser at `http://localhost:5173`
2. Click "Start Recording"
3. Speak into your microphone
4. See real-time transcription appear on screen

## Architecture

- **Backend**: Flask-SocketIO server connects to Grok API via WebSocket
- **Frontend**: React app captures audio, converts to PCM16, sends to backend
- **Audio Processing**: Client-side AudioContext converts microphone input to PCM16 format
- **Transcription**: Grok API (Whisper model) transcribes audio in real-time

## License

MIT
