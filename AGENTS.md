# AGENTS.md - Voice Code Project Guidelines

This document provides guidelines for agentic coding agents operating in this repository.

## Project Overview

- **Project Name**: Voice Code
- **Type**: Real-time voice-to-code IDE
- **Stack**: React.js frontend (Vite), Python Flask backend (SocketIO), Grok API
- **Language**: English and Russian voice transcription

## Technology Stack

- **AI Framework**: CAMEL-AI (https://docs.camel-ai.org/)
    - Reference implementation: https://github.com/camel-ai/camel
- **LLM Provider**: Grok API (https://docs.x.ai)
    - API key configured via `OPENAI_API_KEY` in `.env`
- **Frontend**: React.js 19 with Vite
- **Backend**: Python Flask with Flask-SocketIO
- **Real-time Communication**: WebSocket (x.ai Realtime API)
- **Containerization**: Docker with docker-compose

## Build, Lint, and Test Commands

### Frontend (React + Vite)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Lint code (ESLint)
npm run lint

# Preview production build
npm run preview

# Run a single test (if tests exist)
npm test -- --run
```

### Backend (Python Flask)

```bash
# Navigate to backend directory
cd backend

# Create virtual environment (if not exists)
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run backend server
python app.py

# Run a single test (if pytest is added)
pytest path/to/test_file.py::test_function_name -v
```

### Docker

```bash
# Run with docker-compose
docker-compose up --build
```

## Code Style Guidelines

### General Principles

1. **Clean, maintainable code** with proper error handling
2. **Well-documented** with clear comments for complex logic
3. **Follow existing patterns** in the codebase
4. **Use type hints** in Python where possible

### JavaScript/React (Frontend)

**File Structure**:
- Components in `src/`
- Use `.jsx` extension for React components
- Co-locate styles with components using `.css` files

**Naming Conventions**:
- Components: PascalCase (`App.jsx`, `TranscriptionPanel.jsx`)
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case

**Imports**:
```javascript
// React core imports first
import { useState, useEffect, useCallback } from 'react';

// External libraries
import { io } from 'socket.io-client';

// Internal imports
import './App.css';
```

**React Patterns**:
- Use functional components with hooks
- Use `useCallback` for event handlers passed to child components
- Use `useRef` for mutable refs (media recorders, sockets)
- Clean up resources in `useEffect` return function

**Error Handling**:
- Use try/catch for async operations
- Emit errors to UI via socket events
- Log errors to console with descriptive messages

### Python (Backend)

**File Structure**:
- Main application in `backend/app.py`
- Configuration via environment variables in `.env`

**Imports**:
```python
# Standard library first
import base64
import json
import os

# Third-party libraries
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room
from websocket import create_connection, WebSocketConnectionClosedException

# Local imports (last)
from dotenv import load_dotenv
```

**Naming Conventions**:
- Functions: snake_case (`handle_audio_chunk`, `connect_to_xai`)
- Classes: PascalCase
- Constants: UPPER_SNAKE_CASE
- Private methods: prefix with underscore

**Type Hints**:
- Use type hints for function parameters and return values where beneficial
- Example: `def handle_audio_chunk(data: dict) -> None:`

**Error Handling**:
- Use try/except blocks for WebSocket and network operations
- Emit error events to client rather than raising
- Log errors with descriptive messages including session IDs

**SocketIO Patterns**:
- Use `request.sid` for session identification
- Join rooms based on session ID: `join_room(sid)`
- Emit events to specific rooms: `emit('event_name', data, room=sid)`
- Clean up connections on disconnect

### Shared Conventions

**Environment Variables**:
- Store secrets in `.env` (never commit)
- Use `.env.example` for template
- Access via `os.getenv()` in Python, `import.meta.env` in Vite

**Logging**:
- Use console.log/console.error in frontend
- Use print() in backend
- Include context (session IDs, operation names) in logs

**WebSocket Communication**:
- Frontend: Socket.IO client
- Backend: Flask-SocketIO with gevent async mode
- Use JSON for message serialization

## Testing Guidelines

Currently, no test framework is configured. When adding tests:

**Frontend**:
- Use Vitest or Jest
- Place tests alongside components: `Component.test.jsx`
- Run single test: `npm test -- --run path/to/test.jsx`

**Backend**:
- Use pytest
- Place tests in `backend/tests/` directory
- Run single test: `pytest backend/tests/test_file.py::test_name -v`

## Important Notes

1. **Monkey Patching**: In `backend/app.py`, `gevent.monkey.patch_all()` must be called before other imports
2. **CORS**: Backend allows all origins (`cors_allowed_origories="*"`) for development
3. **Secret Key**: Default secret key is insecure; use environment variable in production
4. **Audio Format**: Frontend converts microphone input to PCM16 (16kHz mono) before sending

## Dependencies

**Frontend**: React 19, Vite, Socket.IO-client, Axios
**Backend**: Flask, Flask-SocketIO, gevent, websocket-client, python-dotenv

## Development Workflow

1. Follow Grok API documentation for all LLM-related implementations
2. Prioritize clean, maintainable code with proper error handling
3. Ensure codebase is well-documented with clear comments for complex logic
4. Implement unit tests and integration tests to ensure code reliability
5. Use version control (Git) to track changes
6. Document architecture and design decisions for future maintenance
7. Regularly update dependencies and security patches
