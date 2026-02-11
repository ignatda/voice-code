import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:5000';
const AUDIO_CHUNK_INTERVAL = 100; // ms

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcriptionSegments, setTranscriptionSegments] = useState([]);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const socketRef = useRef(null);
  const lastTranscriptionRef = useRef(''); // To keep track of the last full transcription

  // Callback to handle transcription updates
  const handleTranscriptionUpdate = useCallback((data) => {
    console.log('Raw transcription update:', data);
    
    // Handle conversation item created (final transcription)
    if (data.type === 'conversation.item.created') {
      const item = data.item;
      if (item.type === 'message' && item.role === 'user') {
        const content = item.content?.[0];
        if (content?.type === 'input_audio' && content.transcript) {
          console.log('Final transcription:', content.transcript);
          setTranscriptionSegments(prev => [...prev, content.transcript]);
          setCurrentTranscription('');
          setIsSpeaking(false);
        }
      }
    }
    // Handle input audio transcription completed
    else if (data.type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = data.transcript;
      if (transcript) {
        console.log('Transcription completed:', transcript);
        setTranscriptionSegments(prev => [...prev, transcript]);
        setCurrentTranscription('');
        setIsSpeaking(false);
      }
    }
    // Handle speech detection
    else if (data.type === 'input_audio_buffer.speech_started') {
      console.log('Speech started');
      setIsSpeaking(true);
      setCurrentTranscription('...');
    }
    else if (data.type === 'input_audio_buffer.speech_stopped') {
      console.log('Speech stopped');
      setIsSpeaking(false);
    }
  }, []);

  useEffect(() => {
    if (!socketRef.current) { // Ensure socket is only initialized once
      socketRef.current = io(SOCKET_SERVER_URL, {
        transports: ['websocket'],
        // upgrade: false // Removed to allow default upgrade mechanisms
      });

      socketRef.current.on('connect', () => {
        console.log('Socket.IO: Connected to backend.');
        setIsConnected(true); // Update connection status
        setError('');
      });

      socketRef.current.on('transcription_update', handleTranscriptionUpdate);

      socketRef.current.on('transcription_started', () => {
        console.log('Socket.IO: Transcription stream started on backend.');
        setIsTranscribing(true);
        setError('');
        setTranscriptionSegments([]); // Clear previous full segments
        setCurrentTranscription(''); // Clear previous partial
      });

      socketRef.current.on('transcription_stopped', () => {
        console.log('Socket.IO: Transcription stream stopped on backend.');
        setIsTranscribing(false);
        // Keep existing transcriptions, clear current one
        setCurrentTranscription('');
      });

      socketRef.current.on('error', (data) => {
        console.error('Socket.IO: Error:', data);
        setError(data.message || 'An error occurred with the transcription service.');
        setIsRecording(false);
        setIsTranscribing(false);
        // Do not disconnect here, let disconnect event handle that
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          console.log('Socket.IO: Stopping MediaRecorder due to error.'); // Added logging
          mediaRecorderRef.current.stop();
        }
        if (audioStreamRef.current) {
          console.log('Socket.IO: Stopping audio stream tracks due to error.'); // Added logging
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        }
      });

      socketRef.current.on('disconnect', () => {
        console.log('Socket.IO: Disconnected from backend.');
        setIsConnected(false); // Update connection status
        setIsRecording(false);
        setIsTranscribing(false);
        setError('Disconnected from service.');
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          console.log('Socket.IO: Stopping MediaRecorder due to disconnect.'); // Added logging
          mediaRecorderRef.current.stop();
        }
        if (audioStreamRef.current) {
          console.log('Socket.IO: Stopping audio stream tracks due to disconnect.'); // Added logging
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        }
      });
    }

    return () => {
      console.log('Socket.IO: useEffect cleanup initiated.'); // Added logging
      if (socketRef.current && isConnected) { // Only disconnect if it was connected
        console.log('Socket.IO: Disconnecting socket during cleanup.'); // Added logging
        socketRef.current.off('transcription_update', handleTranscriptionUpdate);
        socketRef.current.disconnect();
        socketRef.current = null; // Clear ref to allow re-initialization on remount if needed
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        console.log('Socket.IO: Stopping MediaRecorder during cleanup.'); // Added logging
        mediaRecorderRef.current.stop();
      }
      if (audioStreamRef.current) {
        console.log('Socket.IO: Stopping audio stream tracks during cleanup.'); // Added logging
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [handleTranscriptionUpdate, isConnected]); // Add isConnected to dependency array

  const startRecording = async () => {
    console.log('Start Recording: Attempting to start.');
    if (!socketRef.current || !isConnected) {
      setError('Not connected to the transcription service.');
      console.error('Start Recording: Not connected to socket.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      audioStreamRef.current = stream;

      console.log('Start Recording: Emitting start_transcription_stream.');
      socketRef.current.emit('start_transcription_stream');

      socketRef.current.once('transcription_started', () => {
        console.log('Start Recording: Transcription started, setting up audio.');
        setIsRecording(true);
        setError('');

        // Setup audio processing AFTER transcription is confirmed
        const audioContext = new AudioContext({ sampleRate: 24000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        let silenceFrames = 0;
        const SILENCE_THRESHOLD = 0.01;
        const SILENCE_FRAMES_BEFORE_COMMIT = 8;
        let isSilent = false;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          
          if (rms < SILENCE_THRESHOLD) {
            silenceFrames++;
            if (silenceFrames === SILENCE_FRAMES_BEFORE_COMMIT && !isSilent) {
              console.log('Silence detected, committing audio');
              socketRef.current.emit('commit_audio');
              isSilent = true;
            }
          } else {
            if (isSilent) {
              console.log('Speech resumed');
              isSilent = false;
            }
            silenceFrames = 0;
            socketRef.current.emit('audio_chunk', pcm16.buffer);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        mediaRecorderRef.current = { audioContext, processor, source };
      });

      socketRef.current.once('error', (data) => {
        console.error('Start Recording: Error during transcription stream:', data);
        setError(data.message || 'Failed to start transcription stream.');
        setIsRecording(false);
        setIsTranscribing(false);
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        }
      });

    } catch (err) {
      setError('Error accessing microphone. Please grant permission.');
      console.error('Start Recording: Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    console.log('Stop Recording: Attempting to stop.');
    if (mediaRecorderRef.current) {
      const { audioContext, processor, source } = mediaRecorderRef.current;
      if (processor) processor.disconnect();
      if (source) source.disconnect();
      if (audioContext) audioContext.close();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
    if (socketRef.current && socketRef.current.connected) {
      console.log('Stop Recording: Emitting stop_transcription_stream.');
      socketRef.current.emit('stop_transcription_stream');
    }
  };

  const handleToggleRecording = () => {
    console.log('handleToggleRecording: current isRecording state:', isRecording); // Added logging
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Real-time Voice to Text (Grok)</h1>
        {isRecording && (
          <div className="mic-indicator">
            <svg 
              className={`mic-icon ${isSpeaking ? 'speaking' : ''}`}
              viewBox="0 0 24 24" 
              width="48" 
              height="48"
            >
              <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
            <span className="recording-text">{isSpeaking ? 'Speaking...' : 'Listening...'}</span>
          </div>
        )}
        <button
          onClick={handleToggleRecording}
          disabled={!isConnected || (isRecording && !isTranscribing)}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
        {error && <p className="error">{error}</p>}
        <div className="transcription-container">
          {transcriptionSegments.map((text, index) => (
            <p key={index} className="transcription-segment">{text}</p>
          ))}
          {currentTranscription && (
            <p className="current-transcription">{currentTranscription}<span>_</span></p> // blinking cursor
          )}
          {!isRecording && transcriptionSegments.length === 0 && !currentTranscription && <p>Click "Start Recording" and speak.</p>}
          {isRecording && !isTranscribing && <p>Connecting to transcription service...</p>}
          {isRecording && isTranscribing && !currentTranscription && transcriptionSegments.length === 0 && <p>Listening...</p>}
        </div>
      </header>
    </div>
  );
}

export default App;
