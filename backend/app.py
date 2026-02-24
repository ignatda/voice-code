import base64
import json
import os

from gevent import monkey
monkey.patch_all() # Must be called before other imports that are affected by monkey-patching

from dotenv import load_dotenv # Import load_dotenv
load_dotenv() # Load environment variables from .env

from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room
from websocket import create_connection, WebSocketConnectionClosedException

from agents import OrchestratorAgent, BrowserAgent, IDEAgent

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'  # Consider using a more secure key in production
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent') # Use gevent for async

XAI_API_KEY = os.getenv("OPENAI_API_KEY")
base_url = "wss://us-east-1.api.x.ai/v1/realtime"

# Dictionary to hold x.ai WebSocket connections, keyed by SocketIO session ID
xai_connections = {}
# Dictionary to track speech state for each session
speech_active = {}

# Initialize agents
orchestrator_agent = OrchestratorAgent()
browser_agent = BrowserAgent()
ide_agent = IDEAgent()

def send_xai_message(ws, event):
    ws.send(json.dumps(event))

def process_with_orchestrator(transcription: str, sid: str):
    print(f"[orchestrator] Processing transcription, sid={sid[:8]}, text_len={len(transcription)}")
    
    result = orchestrator_agent.process(transcription)
    
    print(f"[orchestrator] Generated {len(result.get('prompts', []))} prompts")
    
    socketio.emit('transcription_result', result, room=sid)
    
    for prompt_info in result.get('prompts', []):
        agent_type = prompt_info.get('agent')
        prompt = prompt_info.get('prompt', '')
        
        if agent_type == 'browser':
            browser_agent.process(prompt)
        elif agent_type == 'ide':
            ide_agent.process(prompt)

def on_xai_message(ws, message, sid):
    if not message:
        return
    try:
        data = json.loads(message)
        msg_type = data.get('type', 'unknown')
        print(f"[x.ai → backend] type={msg_type}, sid={sid[:8]}")
        
        # Track speech state
        if data.get('type') == 'input_audio_buffer.speech_started':
            speech_active[sid] = True
        elif data.get('type') == 'input_audio_buffer.speech_stopped':
            speech_active[sid] = False
        
        # Handle final transcription - process with orchestrator
        if data.get('type') == 'conversation.item.created':
            item = data.get('item', {})
            if item.get('type') == 'message' and item.get('role') == 'user':
                content = item.get('content', [])
                for c in content:
                    if c.get('type') == 'input_audio' and c.get('transcript'):
                        transcript = c.get('transcript')
                        process_with_orchestrator(transcript, sid)
        
        # Also handle input_audio_transcription.completed
        if data.get('type') == 'conversation.item.input_audio_transcription.completed':
            transcript = data.get('transcript')
            if transcript:
                process_with_orchestrator(transcript, sid)
        
        socketio.emit('transcription_update', data, room=sid)
    except json.JSONDecodeError:
        print(f"[x.ai → backend] non-json message, sid={sid[:8]}, len={len(message)}")

def on_xai_open(ws):
    print("[x.ai] Connected to x.ai server.")
    session_config = {
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "instructions": "Transcribe the audio accurately. Use English for all IT terminology, programming keywords, code-related words, technical terms, and coding concepts (e.g., function, class, variable, array, string, import, return, etc.). Use Russian only for general conversational words and non-technical speech.",
            "input_audio_format": "pcm16",
            "input_audio_transcription": {
                "model": "whisper-1"
            },
            "turn_detection": None
        }
    }
    send_xai_message(ws, session_config)

def handle_xai_messages(ws, sid):
    try:
        while True:
            message = ws.recv()
            on_xai_message(ws, message, sid)
    except WebSocketConnectionClosedException:
        print(f"[x.ai] Connection closed normally, sid={sid[:8]}")
    except Exception as e:
        print(f"[x.ai] Error in message handler, sid={sid[:8]}: {e}")
    finally:
        if sid in xai_connections:
            try:
                ws.close()
            except:
                pass
            del xai_connections[sid]
            socketio.emit('transcription_stopped', {'message': 'Connection closed.'}, room=sid)

@socketio.on('connect')
def connect():
    sid = request.sid  # type: ignore
    print(f'[socketio] Client connected, sid={sid[:8]}')
    join_room(sid) # Each client gets their own room named after their sid
    emit('my response', {'data': f'Connected. Send start_transcription_stream to begin.'}, room=sid)

@socketio.on('disconnect')
def disconnect():
    sid = request.sid  # type: ignore
    print(f'[socketio] Client disconnected, sid={sid[:8]}')
    if sid in xai_connections:
        print(f"[x.ai] Closing connection due to client disconnect, sid={sid[:8]}")
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
    print(f"[socketio] start_transcription_stream, sid={sid[:8]}")
    if not XAI_API_KEY:
        emit('error', {'message': 'XAI_API_KEY not configured on server.'}, room=sid)
        return
    if sid in xai_connections:
        emit('error', {'message': 'Transcription stream already active.'}, room=sid)
        return

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
            print(f"[x.ai] Failed to connect, sid={sid[:8]}: {e}")
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
            print(f"[frontend → x.ai] audio chunk, size={len(data)} bytes, sid={sid[:8]}")
        except Exception as e:
            print(f"[backend] Error sending audio chunk, sid={sid[:8]}: {e}")

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
            print(f"[frontend → x.ai] audio committed, sid={sid[:8]}")
        except Exception as e:
            print(f"[backend] Error committing audio, sid={sid[:8]}: {e}")

@socketio.on('stop_transcription_stream')
def stop_transcription_stream():
    sid = request.sid  # type: ignore
    print(f"[socketio] stop_transcription_stream, sid={sid[:8]}")
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

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
