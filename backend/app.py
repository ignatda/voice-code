import json
import os
from typing import Any

import gevent
from gevent import monkey
monkey.patch_all() # Must be called before other imports that are affected by monkey-patching

from dotenv import load_dotenv # Import load_dotenv
load_dotenv() # Load environment variables from .env

from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from websocket import create_connection, WebSocketConnectionClosedException

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'  # Consider using a more secure key in production
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent') # Use gevent for async

XAI_API_KEY = os.getenv("OPENAI_API_KEY")
base_url = "wss://us-east-1.api.x.ai/v1/realtime"

# Dictionary to hold x.ai WebSocket connections, keyed by SocketIO session ID
xai_connections = {}

def send_xai_message(ws, event):
    ws.send(json.dumps(event))

def on_xai_message(ws, message, sid):
    if not message:
        return
    try:
        data = json.loads(message)
        print(f"Received from x.ai for SID {sid}:", json.dumps(data, indent=2))
        socketio.emit('transcription_update', data, room=sid)
    except json.JSONDecodeError:
        print(f"Non-JSON message from x.ai for SID {sid}: {message[:100]}")

def on_xai_open(ws):
    print("Connected to x.ai server.")
    session_config = {
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "instructions": "Transcribe the audio accurately in English or Russian.",
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
        print(f"x.ai connection for SID {sid} closed normally.")
    except Exception as e:
        print(f"Error in x.ai message handler for SID {sid}: {e}")
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
    sid = request.sid # Get the session ID for the connected client
    print(f'Client connected: {sid}')
    join_room(sid) # Each client gets their own room named after their sid
    emit('my response', {'data': f'Connected. Send start_transcription_stream to begin.'}, room=sid)

@socketio.on('disconnect')
def disconnect():
    sid = request.sid
    print(f'Client disconnected: {sid}')
    if sid in xai_connections:
        print(f"Closing x.ai connection for SID {sid} due to client disconnect.")
        try:
            xai_connections[sid].close()
            del xai_connections[sid]
        except:
            pass

@socketio.on('start_transcription_stream')
def start_transcription_stream():
    sid = request.sid
    print(f"Client {sid} requested to start transcription stream.")
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
            print(f"Failed to connect to x.ai for SID {sid}: {e}")
            socketio.emit('error', {'message': f'Failed to connect to x.ai: {e}'}, room=sid)
            if sid in xai_connections:
                del xai_connections[sid]

    socketio.start_background_task(connect_to_xai_and_handle)

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    sid = request.sid
    if sid in xai_connections:
        ws = xai_connections[sid]
        try:
            import base64
            audio_base64 = base64.b64encode(data).decode('utf-8')
            audio_event = {
                "type": "input_audio_buffer.append",
                "audio": audio_base64
            }
            ws.send(json.dumps(audio_event))
            print(f"Sent {len(data)} bytes of audio for SID {sid}")
        except Exception as e:
            print(f"Error sending audio chunk for SID {sid}: {e}")

@socketio.on('commit_audio')
def commit_audio():
    sid = request.sid
    if sid in xai_connections:
        ws = xai_connections[sid]
        try:
            commit_event = {
                "type": "input_audio_buffer.commit"
            }
            ws.send(json.dumps(commit_event))
            print(f"Committed audio buffer for SID {sid}")
        except Exception as e:
            print(f"Error committing audio for SID {sid}: {e}")

@socketio.on('stop_transcription_stream')
def stop_transcription_stream():
    sid = request.sid
    print(f"Client {sid} requested to stop transcription stream.")
    if sid in xai_connections:
        try:
            xai_connections[sid].close()
            del xai_connections[sid]
        except:
            pass
        emit('transcription_stopped', {'message': 'Transcription stream stopped.'}, room=sid)
    else:
        emit('error', {'message': 'No active transcription stream to stop.'}, room=sid)

if __name__ == '__main__':
    socketio.run(app, port=5000, debug=False, allow_unsafe_werkzeug=True)
