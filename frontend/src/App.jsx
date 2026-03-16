import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import MarkdownMessage from './MarkdownMessage';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:5000';

function App() {
  const [micEnabled, setMicEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('idle');
  const [conversationItems, setConversationItems] = useState([]);
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(() => localStorage.getItem('readOnlyMode') === 'true');
  const [promptText, setPromptText] = useState('');
  const [sessionList, setSessionList] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const audioContextRef = useRef(null);
  const audioStreamRef = useRef(null);
  const socketRef = useRef(null);
  const conversationEndRef = useRef(null);

  const handleSessionSwitched = useCallback((data) => {
    setActiveSessionId(data.id);
    setConversationItems(data.items || []);
  }, []);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_SERVER_URL, {
        transports: ['websocket'],
      });
    }

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      setError('');
      socketRef.current.emit('set_read_only', localStorage.getItem('readOnlyMode') === 'true');
      socketRef.current.emit('get_sessions');
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
      setMicEnabled(false);
      setStatus('idle');
    });

    socketRef.current.on('status', (data) => setStatus(data.status));

    socketRef.current.on('session_list', (list) => setSessionList(list));
    socketRef.current.on('session_switched', handleSessionSwitched);
    socketRef.current.on('session_deleted', (id) => {
      if (id === activeSessionId) {
        setActiveSessionId(null);
        setConversationItems([]);
      }
    });

    socketRef.current.on('transcription_started', () => {});

    socketRef.current.on('transcription_update', (data) => {
      if (data.type === 'transcript' && data.text) {
        setConversationItems(prev => {
          if (prev.length > 0 && prev[prev.length - 1].type === 'user' && prev[prev.length - 1].text === data.text) {
            return prev;
          }
          return [...prev, { type: 'user', text: data.text }];
        });
      }
    });

    socketRef.current.on('transcription_result', (data) => {
      if (data.original_text) {
        setConversationItems(prev => {
          if (prev.length > 0 && prev[prev.length - 1].type === 'user' && prev[prev.length - 1].text === data.original_text) {
            return prev;
          }
          return [...prev, { type: 'user', text: data.original_text }];
        });
      }
      if (data.prompts?.length > 0) {
        setConversationItems(prev => [
          ...prev,
          ...data.prompts.map(p => ({ type: 'agent', agent: 'orchestrator', text: p.prompt }))
        ]);
      }
    });

    socketRef.current.on('ready_for_audio', () => {});

    socketRef.current.on('browser_result', (data) => {
      const text = data.message || data.error || 'No response';
      setConversationItems(prev => [...prev, { type: 'agent', agent: 'browser', text }]);
    });

    socketRef.current.on('ide_result', (data) => {
      const text = data.message || 'No response';
      setConversationItems(prev => [...prev, { type: 'agent', agent: 'jetbrains', text }]);
    });

    socketRef.current.on('transcription_stopped', () => {});

    socketRef.current.on('agents_stopped', () => {
      setConversationItems(prev => [...prev, { type: 'system', text: '⛔ All agents stopped.' }]);
      setStatus('idle');
    });

    socketRef.current.on('error', (data) => {
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
  }, [handleSessionSwitched]);

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

    } catch (_) {
      setError('Error accessing microphone.');
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

  const stopAll = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('stop_all');
    }
  };

  const toggleReadOnly = () => {
    setReadOnly(prev => {
      const next = !prev;
      localStorage.setItem('readOnlyMode', String(next));
      if (socketRef.current?.connected) {
        socketRef.current.emit('set_read_only', next);
      }
      return next;
    });
  };

  const submitPrompt = () => {
    const text = promptText.trim();
    if (!text || !socketRef.current?.connected) return;
    setConversationItems(prev => [...prev, { type: 'user', text }]);
    socketRef.current.emit('manual_prompt', text);
    setPromptText('');
    const ta = document.querySelector('.prompt-input');
    if (ta) ta.style.height = 'auto';
  };

  const createNewSession = () => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('create_session');
    }
  };

  const switchSession = (id) => {
    if (socketRef.current?.connected && id !== activeSessionId) {
      socketRef.current.emit('switch_session', id);
    }
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    if (socketRef.current?.connected) {
      socketRef.current.emit('delete_session', id);
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
    <div className={`App${readOnly ? ' read-only' : ''}`}>
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Sessions</span>
          <button className="new-session-btn" onClick={createNewSession} title="New session">+</button>
        </div>
        <div className="session-list">
          {sessionList.map(s => (
            <div
              key={s.id}
              className={`session-item${s.id === activeSessionId ? ' active' : ''}`}
              onClick={() => switchSession(s.id)}
            >
              <span className="session-name">{s.name}</span>
              <button className="delete-session-btn" onClick={(e) => deleteSession(e, s.id)} title="Delete">×</button>
            </div>
          ))}
          {sessionList.length === 0 && (
            <p className="no-sessions">No sessions yet</p>
          )}
        </div>
      </aside>

      {/* Main area */}
      <div className="main-area">
        <header className="top-bar">
          <div className="status-indicator">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(p => !p)} title="Toggle sessions">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
              </svg>
            </button>
            <span className={`status-dot ${status}`}></span>
            <span className="status-label">{getStatusText()}</span>
            {readOnly && <span className="readonly-badge">READ-ONLY</span>}
          </div>

          <div className="controls">
            <button
              className={`mic-toggle ${micEnabled ? 'enabled' : ''}`}
              onClick={toggleMic}
              disabled={!isConnected}
              title={micEnabled ? 'Disable microphone' : 'Enable microphone'}
            >
              {micEnabled ? (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>

            <button
              className="stop-button"
              onClick={stopAll}
              disabled={!isConnected || status === 'idle'}
              title="Stop all agents"
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/>
              </svg>
            </button>

            <button
              className={`readonly-toggle${readOnly ? ' active' : ''}`}
              onClick={toggleReadOnly}
              title="Toggle Read-Only Mode"
            >
              {readOnly ? (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
              )}
            </button>
          </div>
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
                {item.type === 'agent' ? (
                  <MarkdownMessage text={item.text} />
                ) : (
                  <span className={`conversation-text ${item.type}`}>{item.text}</span>
                )}
              </div>
            ))}
            <div ref={conversationEndRef} />
          </div>
        </main>

        <div className="prompt-bar">
          <textarea
            className="prompt-input"
            placeholder="Type a prompt..."
            value={promptText}
            rows={1}
            onChange={e => {
              setPromptText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
              }
            }}
            disabled={!isConnected}
          />
          <button
            className="prompt-send"
            onClick={submitPrompt}
            disabled={!isConnected || !promptText.trim()}
            title="Send prompt"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
