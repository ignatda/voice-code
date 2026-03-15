import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:5000';

function App() {
  const [micEnabled, setMicEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('idle');
  const [conversationItems, setConversationItems] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [error, setError] = useState('');

  const audioContextRef = useRef(null);
  const audioStreamRef = useRef(null);
  const socketRef = useRef(null);
  const conversationEndRef = useRef(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_SERVER_URL, {
        transports: ['websocket'],
      });
    }

    socketRef.current.on('connect', () => {
      console.log('[socket] Connected to backend');
      setIsConnected(true);
      setError('');
    });

    socketRef.current.on('disconnect', () => {
      console.log('[socket] Disconnected from backend');
      setIsConnected(false);
      setMicEnabled(false);
      setStatus('idle');
    });

    socketRef.current.on('status', (data) => {
      console.log('[socket] Status:', data.status);
      setStatus(data.status);
    });

    socketRef.current.on('transcription_started', () => {
      console.log('[socket] Transcription stream started');
    });

    socketRef.current.on('transcription_update', (data) => {
      if (data.type === 'transcript' && data.text) {
        console.log('[socket] Live transcript:', data.text);
        setConversationItems(prev => {
          if (prev.length > 0 && prev[prev.length - 1].type === 'user' && prev[prev.length - 1].text === data.text) {
            return prev;
          }
          return [...prev, { type: 'user', text: data.text }];
        });
      }
    });

    socketRef.current.on('transcription_result', (data) => {
      console.log('[socket] Transcription result:', data);
      if (data.original_text) {
        setConversationItems(prev => {
          if (prev.length > 0 && prev[prev.length - 1].type === 'user' && prev[prev.length - 1].text === data.original_text) {
            return prev;
          }
          return [...prev, { type: 'user', text: data.original_text }];
        });
      }
      if (data.prompts?.length > 0) {
        setPrompts(data.prompts);
      }
    });

    socketRef.current.on('ready_for_audio', () => {
      console.log('[socket] Ready for audio');
    });

    socketRef.current.on('browser_result', (data) => {
      console.log('[socket] Browser result:', data);
      const text = data.message || data.error || 'No response';
      setConversationItems(prev => [...prev, { type: 'agent', agent: 'browser', text }]);
    });

    socketRef.current.on('transcription_stopped', () => {
      console.log('[socket] Transcription stopped');
    });

    socketRef.current.on('error', (data) => {
      console.error('[socket] Error:', data.message);
      setError(data.message);
      setMicEnabled(false);
      setStatus('idle');
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationItems]);

  const toggleMic = async () => {
    if (micEnabled) {
      disableMic();
    } else {
      enableMic();
    }
  };

  const enableMic = async () => {
    if (!socketRef.current || !isConnected) {
      setError('Not connected to the service.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false
        }
      });
      audioStreamRef.current = stream;

      socketRef.current.emit('start_transcription_stream');

      socketRef.current.once('transcription_started', async () => {
        setMicEnabled(true);
        setError('');

        const audioContext = new AudioContext({ sampleRate: 24000 });
        const source = audioContext.createMediaStreamSource(stream);
        
        await audioContext.audioWorklet.addModule('/AudioProcessorWorklet.js');
        
        const workletNode = new AudioWorkletNode(audioContext, 'noise-cancelling-processor');
        
        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audio') {
            socketRef.current.emit('audio_chunk', event.data.data);
          }
        };
        
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
        
        audioContextRef.current = { audioContext, workletNode, source };
      });

    } catch (err) {
      setError('Error accessing microphone.');
      console.error('[mic] Error:', err);
    }
  };

  const disableMic = () => {
    if (audioContextRef.current) {
      const { audioContext, workletNode, source } = audioContextRef.current;
      if (workletNode) workletNode.disconnect();
      if (source) source.disconnect();
      if (audioContext) audioContext.close();
      audioContextRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    setMicEnabled(false);
    setStatus('idle');
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('stop_transcription_stream');
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'listening': return 'Listening';
      case 'speaking': return 'Speaking';
      case 'preparing': return 'Processing';
      case 'executing': return 'Executing';
      default: return 'Idle';
    }
  };

  return (
    <div className="App">
      <header className="top-bar">
        <div className="status-indicator">
          <span className={`status-dot ${status}`}></span>
          <span className="status-label">{getStatusText()}</span>
        </div>

        <button
          className={`mic-toggle ${micEnabled ? 'enabled' : ''}`}
          onClick={toggleMic}
          disabled={!isConnected}
          title={micEnabled ? 'Disable microphone' : 'Enable microphone'}
        >
          {micEnabled ? (
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      </header>

      <main className="content">
        <div className="terminal-body">
          {error && <p className="error">{error}</p>}
          
          {conversationItems.length === 0 && status === 'idle' && !error && (
            <p className="hint">Click the microphone to start listening</p>
          )}

          {conversationItems.map((item, index) => (
            <div key={index} className={`conversation-line ${item.type}`}>
              <span className="line-number">{index + 1}</span>
              {item.type === 'agent' && (
                <span className="agent-badge">{item.agent}</span>
              )}
              <span className={`conversation-text ${item.type}`}>{item.text}</span>
            </div>
          ))}
          <div ref={conversationEndRef} />
        </div>
      </main>

      <footer className="command-panel">
        <div className="command-list">
          {prompts.map((prompt, index) => (
            <div key={index} className="command-item">
              <span className="agent-badge">{prompt.agent}</span>
              <span className="command-text">{prompt.prompt}</span>
            </div>
          ))}
          {prompts.length === 0 && (
            <span className="no-commands">No commands yet</span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
