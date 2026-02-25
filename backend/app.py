import base64
import json
import os
from datetime import datetime

def log(msg, sid=None):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    if sid:
        print(f"[{ts}] {msg}, sid={sid[:8]}")
    else:
        print(f"[{ts}] {msg}")

from gevent import monkey
monkey.patch_all() # Must be called before other imports that are affected by monkey-patching

from dotenv import load_dotenv # Import load_dotenv
load_dotenv() # Load environment variables from .env

XAI_API_KEY = os.getenv("OPENAI_API_KEY")
base_url = "wss://us-east-1.api.x.ai/v1/realtime" if XAI_API_KEY else None

from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room
from websocket import create_connection, WebSocketConnectionClosedException

from agents import OrchestratorAgent, BrowserAgent, IDEAgent

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'  # Consider using a more secure key in production
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent') # Use gevent for async

# Global state
xai_connections = {}
speech_active = {}
audio_stats = {}
status_map = {}

# Initialize agents
orchestrator_agent = OrchestratorAgent()
browser_agent = BrowserAgent()
ide_agent = IDEAgent()

def send_xai_message(ws, event):
    ws.send(json.dumps(event))

def process_with_orchestrator(transcription: str, sid: str):
    log(f"[orchestrator] Processing transcription, text_len={len(transcription)}", sid)

    result = orchestrator_agent.process(transcription)

    prompts = result.get('prompts', [])
    log(f"[orchestrator] Generated {len(prompts)} prompts: {prompts}", sid)
    log(f"[socketio] Emitting transcription_result", sid)

    socketio.emit('transcription_result', result, room=sid)

    for prompt_info in result.get('prompts', []):
        agent_type = prompt_info.get('agent')
        prompt = prompt_info.get('prompt', '')

        if agent_type == 'browser':
            socketio.start_background_task(target=lambda: run_browser_command(prompt, sid))
        elif agent_type == 'ide':
            ide_agent.process(prompt)

def run_browser_command(prompt: str, sid: str):
    log(f"[browser_agent] Processing command: {prompt}", sid)
    try:
        result = browser_agent.process(prompt)
        socketio.emit('browser_result', result, room=sid)
    except Exception as e:
        log(f"[browser_agent] Error: {e}", sid)
        socketio.emit('browser_result', {'status': 'error', 'error': str(e)}, room=sid)

def on_xai_message(ws, message, sid):
    if not message:
        return
    try:
        data = json.loads(message)
        msg_type = data.get('type', 'unknown')

        # Track status based on x.ai events and our own logic
        current_status = status_map.get(sid, 'idle')

        # Speech started - user is speaking
        if data.get('type') == 'input_audio_buffer.speech_started':
            speech_active[sid] = True
            status_map[sid] = 'speaking'
            log(f"[x.ai] Speech started", sid)
            socketio.emit('status', {'status': 'speaking'}, room=sid)

        # Speech stopped - x.ai detected end of speech
        if data.get('type') == 'input_audio_buffer.speech_stopped':
            speech_active[sid] = False
            log(f"[x.ai] Speech stopped", sid)

            # Commit the audio buffer and create a response to trigger transcription
            if sid in xai_connections:
                try:
                    ws = xai_connections[sid]
                    commit_event = {"type": "input_audio_buffer.commit"}
                    ws.send(json.dumps(commit_event))

                    response_event = {
                        "type": "response.create",
                        "response": {
                            "modalities": ["text"]
                        }
                    }
                    ws.send(json.dumps(response_event))
                    log(f"[x.ai] Audio committed and response created", sid)
                except Exception as e:
                    log(f"[backend] Error committing audio after speech stop: {e}", sid)

        # Handle final transcription - process with orchestrator
        elif data.get('type') == 'conversation.item.added':
            item = data.get('item', {})
            if item.get('type') == 'message' and item.get('role') == 'user':
                content = item.get('content', [])
                for c in content:
                    if c.get('type') == 'input_audio' and c.get('transcript'):
                        transcript = c.get('transcript')
                        log(f"[x.ai → backend] Got transcript: '{transcript}'", sid)

                        # Emit transcription immediately to frontend
                        socketio.emit('transcription_update', {'type': 'transcript', 'text': transcript}, room=sid)

                        status_map[sid] = 'executing'
                        socketio.emit('status', {'status': 'executing'}, room=sid)
                        process_with_orchestrator(transcript, sid)

        # Clear buffer after response is done to continue listening
        elif data.get('type') == 'response.done':
            if sid in xai_connections:
                try:
                    log(f"[x.ai → backend] Response done", sid)
                    status_map[sid] = 'idle'
                    socketio.emit('status', {'status': 'idle'}, room=sid)
                except Exception as e:
                    log(f"[backend] Error in response.done: {e}", sid)

        # Log all events for debugging
        log(f"[x.ai → backend] type={msg_type}", sid)

        # Log error details
        if msg_type == 'error':
            log(f"[x.ai → backend] ERROR details: {data}", sid)

        # Respond to ping with pong immediately
        if msg_type == 'ping':
            try:
                ws.send(json.dumps({"type": "pong"}))
            except Exception as e:
                log(f"[x.ai] Error sending pong: {e}", sid)

        socketio.emit('transcription_update', data, room=sid)
    except Exception as e:
        log(f"[x.ai → backend] Error processing message: {e}", sid)

def on_xai_open(ws):
    log("[x.ai] Connected to x.ai server.")
    session_config = {
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "instructions": "Transcribe the audio accurately. Use English for all IT terminology, programming keywords, code-related words, technical terms, and coding concepts (e.g., function, class, variable, array, string, import, return, etc.). Use Russian only for general conversational words and non-technical speech.",
            "input_audio_format": "pcm16",
            "input_audio_transcription": {
                "model": "whisper-1"
            },
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.2,
                "prefix_padding_ms": 500,
                "silence_duration_ms": 1000
            }
        }
    }
    send_xai_message(ws, session_config)

def handle_xai_messages(ws, sid):
    try:
        while True:
            message = ws.recv()
            on_xai_message(ws, message, sid)
    except WebSocketConnectionClosedException:
        log(f"[x.ai] Connection closed normally", sid)
        if sid in xai_connections:
            del xai_connections[sid]
            socketio.emit('transcription_stopped', {'message': 'Connection closed.'}, room=sid)
    except Exception as e:
        log(f"[x.ai] Error in message handler: {e}", sid)
        if sid in xai_connections:
            try:
                ws.close()
            except:
                pass
            del xai_connections[sid]
            socketio.emit('error', {'message': f'Connection error: {e}'}, room=sid)

@socketio.on('connect')
def connect():
    sid = request.sid  # type: ignore
    log(f'[socketio] Client connected', sid)
    join_room(sid) # Each client gets their own room named after their sid
    emit('my response', {'data': f'Connected. Send start_transcription_stream to begin.'}, room=sid)

@socketio.on('disconnect')
def disconnect():
    sid = request.sid  # type: ignore
    log(f'[socketio] Client disconnected', sid)
    if sid in xai_connections:
        log(f"[x.ai] Closing connection due to client disconnect", sid)
        try:
            xai_connections[sid].close()
            del xai_connections[sid]
        except:
            pass
    if sid in speech_active:
        del speech_active[sid]

@socketio.on('start_transcription_stream')
def start_transcription_stream():
    sid = request.sid  # type: ignore
    log(f"[socketio] start_transcription_stream", sid)
    if not XAI_API_KEY:
        emit('error', {'message': 'XAI_API_KEY not configured on server.'}, room=sid)
        return
    if sid in xai_connections:
        emit('error', {'message': 'Transcription stream already active.'}, room=sid)
        return

    # Initialize status
    status_map[sid] = 'idle'

    def connect_to_xai_and_handle():
        try:
            ws = create_connection(
                base_url,
                header={"Authorization": f"Bearer {XAI_API_KEY}"}
            )
            xai_connections[sid] = ws
            on_xai_open(ws)

            socketio.emit('transcription_started', {'message': 'Connected to x.ai and ready for audio.'}, room=sid)
            handle_xai_messages(ws, sid)
        except Exception as e:
            log(f"[x.ai] Failed to connect: {e}", sid)
            socketio.emit('error', {'message': f'Failed to connect to x.ai: {e}'}, room=sid)
            if sid in xai_connections:
                del xai_connections[sid]

    socketio.start_background_task(connect_to_xai_and_handle)

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    sid = request.sid  # type: ignore
    if sid in xai_connections:
        ws = xai_connections[sid]
        try:
            audio_base64 = base64.b64encode(data).decode('utf-8')
            audio_event = {
                "type": "input_audio_buffer.append",
                "audio": audio_base64
            }
            ws.send(json.dumps(audio_event))

            # Set to listening if currently idle (first audio after silence)
            current = status_map.get(sid, 'idle')
            if current == 'idle':
                status_map[sid] = 'listening'
                socketio.emit('status', {'status': 'listening'}, room=sid)

            # Track stats
            if sid not in audio_stats:
                audio_stats[sid] = {'chunks': 0, 'total_bytes': 0}
            audio_stats[sid]['chunks'] += 1
            audio_stats[sid]['total_bytes'] += len(data)
        except Exception as e:
            log(f"[backend] Error sending audio chunk: {e}", sid)

@socketio.on('commit_audio')
def commit_audio():
    sid = request.sid  # type: ignore
    if sid in xai_connections:
        ws = xai_connections[sid]
        try:
            commit_event = {
                "type": "input_audio_buffer.commit"
            }
            ws.send(json.dumps(commit_event))

            response_event = {
                "type": "response.create",
                "response": {
                    "modalities": ["text"]
                }
            }
            ws.send(json.dumps(response_event))

            stats = audio_stats.get(sid, {'chunks': 0, 'total_bytes': 0})
            log(f"[frontend → x.ai] audio committed, chunks={stats['chunks']}, total_bytes={stats['total_bytes']}", sid)

            # Reset stats
            audio_stats[sid] = {'chunks': 0, 'total_bytes': 0}
        except Exception as e:
            log(f"[backend] Error committing audio: {e}", sid)

@socketio.on('stop_transcription_stream')
def stop_transcription_stream():
    sid = request.sid  # type: ignore
    log(f"[socketio] stop_transcription_stream", sid)
    if sid in xai_connections:
        try:
            xai_connections[sid].close()
            del xai_connections[sid]
        except:
            pass
        emit('transcription_stopped', {'message': 'Transcription stream stopped.'}, room=sid)
    else:
        emit('error', {'message': 'No active transcription stream to stop.'}, room=sid)

    if sid in speech_active:
        del speech_active[sid]
    if sid in status_map:
        del status_map[sid]

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
