import React, { useState, useRef, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { type BaseRetriever } from "@langchain/core/retrievers";
import './App.css';

// Import audio files for the walkthrough
import audio1 from './assets/audio/1.mp3';
import audio2 from './assets/audio/2.mp3';
import audio3 from './assets/audio/3.mp3';
import audio4 from './assets/audio/4.mp3';
import audio5 from './assets/audio/5.mp3';
import audio6 from './assets/audio/6.mp3';
import audio7 from './assets/audio/7.mp3';
import audio8 from './assets/audio/8.mp3';
import audio9 from './assets/audio/9.mp3';
import audio10 from './assets/audio/10.mp3';

// Define the structure of a message
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Define the structure of a chat session
interface Chat {
  id: string;
  title: string;
  messages: Message[];
}

// New interface for storing document data
interface LoadedDocument {
  name: string;
  content: string;
}

// Extend the global Window interface to include SpeechRecognition, as it might not be typed
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}


// Data for the walkthrough, mapping text to target element IDs and audio files
const walkthroughData = [
  { text: "For this project I wanted to spin up what is basically a quick chatgpt wrapper but with both text to speech and speech to text so that you can have a continuous conversation with the bot verbally on desktop.", targetId: "main-chat-area", audioSrc: audio1 },
  { text: "I also added RAG by way of Langchain.", targetId: "rag-controls", audioSrc: audio2 },
  { text: "I try to avoid overloading Cursor with features so I immediately started with a simple prompt to create a React page chatbot with the baseline MVP requirements outlined in the assignment.", targetId: "main-chat-area", audioSrc: audio3 },
  { text: "I wanted to make sure I was building from the ground-up for deployment though, so I ensured that it would be able to launch on GitHub pages.", targetId: "main-chat-area", audioSrc: audio4 },
  { text: "Next, I decided to align with Olivia's colours and add a dropdown for selecting different LLMs.", targetId: "app-header", audioSrc: audio5 },
  { text: "I didn't want you to have to re-enter your api key every time so I make sure the user's browser keeps it in localstorage.", targetId: "api-key-input", audioSrc: audio6 },
  { text: "I also copied the ChatGPT functionality to autogenerate a title for each chat when they are first messaged.", targetId: "chat-title-target", audioSrc: audio7 },
  { text: "Next, I implemented text to speech for interacting with the bot verbally.", targetId: "tts-button", audioSrc: audio8 },
  { text: "And finally, I added speech to text so the user can talk back.", targetId: "stt-button", audioSrc: audio9 },
  { text: "That brings us to the end of the walkthrough. I hope you enjoy using the app and I hope to hear back from you soon!", targetId: "main-chat-area", audioSrc: audio10 }
];


function App() {
  // State variables
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('openai-api-key') || '');
  const [model, setModel] = useState<string>('gpt-4o');
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false); // For speech recognition
  const [isMuted, setIsMuted] = useState<boolean>(false); // For speech synthesis
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false); // For sidebar
  const [voiceCommandToSend, setVoiceCommandToSend] = useState<string | null>(null);
  const [ragRetriever, setRagRetriever] = useState<BaseRetriever | null>(null);
  const [ragStatus, setRagStatus] = useState<string>('No documents loaded.');
  const [loadedDocuments, setLoadedDocuments] = useState<LoadedDocument[]>([]);
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null); // To focus the input
  const recognitionRef = useRef<any>(null); // To hold the SpeechRecognition instance
  const utteranceStartIndexRef = useRef(0); // To track the start of the current utterance
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState<boolean>(false);
  const [isWalkthroughActive, setIsWalkthroughActive] = useState(false);
  const [speechBox, setSpeechBox] = useState({ visible: false, text: '', top: 0, left: 0 });
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null); // To control the audio player

  // This effect runs once on component mount to initialize chats
  useEffect(() => {
    const savedChatsJSON = localStorage.getItem('chatbot-chats');
    if (savedChatsJSON) {
      const savedChats = JSON.parse(savedChatsJSON);
      if (savedChats.length > 0) {
        setChats(savedChats);
        const savedActiveId = localStorage.getItem('chatbot-active-chat-id');
        const activeIdExists = savedChats.some((c: Chat) => c.id === savedActiveId);
        setActiveChatId(activeIdExists ? savedActiveId : savedChats[0].id);
        return; // Exit early
      }
    }
    // If we reach here, there are no saved chats. Create a new one.
    handleNewChat();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Find the currently active chat
  const activeChat = chats.find(chat => chat.id === activeChatId);

  // Effect to re-focus the input when the bot is done responding
  useEffect(() => {
    if (!isLoading && activeChat) {
      inputRef.current?.focus();
    }
  }, [isLoading, activeChat]);

  // Effect to save API key to localStorage
  useEffect(() => {
    localStorage.setItem('openai-api-key', apiKey);
  }, [apiKey]);

  // Effect to save chats and active chat ID to localStorage
  useEffect(() => {
    localStorage.setItem('chatbot-chats', JSON.stringify(chats));
    if (activeChatId) {
      localStorage.setItem('chatbot-active-chat-id', activeChatId);
    }
  }, [chats, activeChatId]);

  // Effect to scroll to the bottom of the chat window
  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [chats, activeChatId]);

  // Effect to set up the SpeechRecognition API
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechRecognitionSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onresult = (event: any) => {
        // Build the transcript for the current utterance only
        let currentUtterance = '';
        for (let i = utteranceStartIndexRef.current; i < event.results.length; i++) {
          currentUtterance += event.results[i][0].transcript;
        }
        setInput(currentUtterance);

        // Check if the last result is final
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const sendCommandRegex = /\s(send|sent)$/i;
          if (sendCommandRegex.test(currentUtterance)) {
            const messageToSend = currentUtterance.replace(sendCommandRegex, '').trim();
            if (messageToSend) {
              // Set state to trigger send, instead of calling executeSend directly
              setVoiceCommandToSend(messageToSend);
              utteranceStartIndexRef.current = event.results.length;
            }
          }
        }
      };

      recognitionRef.current = recognition;
    } else {
      console.warn("Speech Recognition API is not supported in this browser.");
      setIsSpeechRecognitionSupported(false);
    }
  }, []);

  // Function to speak text using the SpeechSynthesis API, memoized with useCallback
  const speak = useCallback((text: string) => {
    if (isMuted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  // Function to toggle speech recognition
  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      utteranceStartIndexRef.current = 0; // Reset for new session
      recognitionRef.current?.start();
    }
  };

  // Function to create a new chat
  const handleNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
    };
    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
  };

  // Function to delete a chat
  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation(); // Prevent the chat from being selected when deleting
    setChats(chats.filter(chat => chat.id !== chatId));
    // If the deleted chat was the active one, select a new active chat
    if (activeChatId === chatId) {
      const remainingChats = chats.filter(chat => chat.id !== chatId);
      setActiveChatId(remainingChats.length > 0 ? remainingChats[0].id : null);
    }
  };

  // Memoized function to build or rebuild the RAG system from the current documents
  const buildRagFromLoadedDocs = useCallback(async () => {
    if (loadedDocuments.length === 0) {
      setRagRetriever(null);
      setRagStatus('No documents loaded.');
      return;
    }

    setRagStatus(`Processing ${loadedDocuments.length} document(s)...`);

    try {
      const docs = loadedDocuments.map(({ content }) => {
        const parser = new DOMParser();
        const docHtml = parser.parseFromString(content, 'text/html');
        return new Document({ pageContent: docHtml.body.textContent || "" });
      });

      const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
      const splitDocs = await splitter.splitDocuments(docs);
      const embeddings = new OpenAIEmbeddings({ openAIApiKey: apiKey });
      const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
      
      setRagRetriever(vectorStore.asRetriever());
      setRagStatus(`Ready. ${loadedDocuments.length} document(s) loaded.`);

    } catch (error) {
      console.error("Error building RAG system:", error);
      setRagStatus('Error processing documents.');
    }
  }, [apiKey, loadedDocuments]);

  // Rebuild the RAG system whenever the documents change
  useEffect(() => {
    buildRagFromLoadedDocs();
  }, [buildRagFromLoadedDocs]);

  // This function now appends new files
  const handleFileUpload = async (files: FileList) => {
    if (!apiKey) {
      alert('Please enter your OpenAI API key before loading documents.');
      return;
    }
    if (!files || files.length === 0) return;

    // Read the new files
    const newDocs: LoadedDocument[] = await Promise.all(
      Array.from(files).map(async (file) => ({
        name: file.name,
        content: await file.text(),
      }))
    );
    
    // Add new documents, preventing duplicates by name
    setLoadedDocuments(prevDocs => {
      const existingNames = new Set(prevDocs.map(d => d.name));
      const filteredNewDocs = newDocs.filter(d => !existingNames.has(d.name));
      return [...prevDocs, ...filteredNewDocs];
    });
  };

  // Function to remove a document and trigger a rebuild
  const handleRemoveDocument = (docNameToRemove: string) => {
    setLoadedDocuments(prevDocs => prevDocs.filter(doc => doc.name !== docNameToRemove));
  };
  
  // Define the system prompt that will be sent to the API with every request.
  // This helps set the behavior and personality of the chatbot.
  const systemPrompt: Message = {
    role: 'system',
    content: 'You are a helpful digital consciousness named Olly that has been created by Zachary Kulik as a demo for the company Olivia.'
  };

  // Function to send a message, wrapped in useCallback to memoize it
  const executeSend = useCallback(async (messageContent: string) => {
    if (messageContent.trim() === '' || isLoading) return;
    if (!apiKey) {
      alert('Please enter your OpenAI API key.');
      return;
    }

    setInput('');
    setIsLoading(true);

    let context = '';
    // If a RAG retriever is set up, use it to find relevant context
    if (ragRetriever) {
        const relevantDocs = await ragRetriever.getRelevantDocuments(messageContent);
        context = relevantDocs.map((doc: Document) => doc.pageContent).join('\n\n---\n\n');
    }

    const messagesForApi: Message[] = [];
    if (context) {
        messagesForApi.push({
            role: 'system',
            content: `Based on the following context, answer the user's question.\n\nContext:\n${context}`
        });
    } else {
        messagesForApi.push(systemPrompt);
    }

    // 1. Determine the target chat and its messages. Create a new chat if needed.
    let targetChat: Chat;
    const userMessage: Message = { role: 'user', content: messageContent };

    if (activeChatId) {
        // An existing chat is active
        const currentChat = chats.find(c => c.id === activeChatId)!;
        const updatedMessages = [...currentChat.messages, userMessage];
        // Update the state immediately to show the user's message
        setChats(chats.map(c => c.id === activeChatId ? { ...c, messages: updatedMessages } : c));
        // Keep a local copy of the updated chat for our API calls
        targetChat = { ...currentChat, messages: updatedMessages };
    } else {
        // No active chat, so we create a new one
        targetChat = {
            id: Date.now().toString(),
            title: 'New Chat',
            messages: [userMessage],
        };
        setActiveChatId(targetChat.id);
        setChats(prev => [targetChat, ...prev]);
    }

    // Add the rest of the conversation history
    messagesForApi.push(...targetChat.messages);

    // The rest of the function will now use the `targetChat` object,
    // ensuring the data is consistent throughout the async operations.
    try {
      const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

      // 2. Generate a title if it's the first message in the chat
      if (targetChat.messages.length === 1) {
        const titlePrompt = `Generate a short, concise title (3-5 words) for the following user query: "${messageContent}"`;
        const titleResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: titlePrompt }],
        });
        const newTitle = titleResponse.choices[0].message.content?.replace(/["']/g, '') || 'Chat';
        
        // Update the title in the state using the functional form of setState
        setChats(prev => prev.map(c => c.id === targetChat.id ? { ...c, title: newTitle } : c));
      }

      // 3. Get the bot's response from the API
      const response = await openai.chat.completions.create({
        model,
        messages: messagesForApi,
      });

      // 4. Add the bot's message to the state
      const botMessage = response.choices[0].message;
      if (botMessage.content) {
        speak(botMessage.content);
        const newBotMessage: Message = { role: 'assistant', content: botMessage.content };
        setChats(prev => prev.map(c => c.id === targetChat.id ? { ...c, messages: [...c.messages, newBotMessage] } : c));
      }
    } catch (error) {
      // 5. Handle any errors from the API
      console.error('Error calling OpenAI API:', error);
      const errorMessageContent = 'Sorry, something went wrong.';
      speak(errorMessageContent);
      const errorMessage: Message = { role: 'assistant', content: errorMessageContent };
      setChats(prev => prev.map(c => c.id === targetChat.id ? { ...c, messages: [...c.messages, errorMessage] } : c));
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, activeChatId, chats, isLoading, model, speak, systemPrompt, ragRetriever]);

  // This new effect will trigger the send command when a voice command is detected.
  useEffect(() => {
    if (voiceCommandToSend) {
      executeSend(voiceCommandToSend);
      setVoiceCommandToSend(null); // Reset the command state
    }
  }, [voiceCommandToSend, executeSend]);

  // Wrapper for UI events like button clicks and key presses
  const handleSend = () => {
    executeSend(input);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  // This function starts the text-to-speech walkthrough
  const startWalkthrough = () => {
    if (isWalkthroughActive) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;
      }
      setIsWalkthroughActive(false);
      setSpeechBox(prev => ({ ...prev, visible: false }));
      return;
    }

    setIsWalkthroughActive(true);
    let currentIndex = 0;

    // Ensure the audio player is created, and it's a new instance to avoid state issues.
    audioPlayerRef.current = new Audio();
    const audioPlayer = audioPlayerRef.current;

    const playNext = () => {
      if (currentIndex >= walkthroughData.length) {
        setIsWalkthroughActive(false);
        setSpeechBox(prev => ({ ...prev, visible: false }));
        return;
      }

      const step = walkthroughData[currentIndex];
      const targetElement = document.getElementById(step.targetId);

      // Default position if element not found
      let top = 150;
      let left = window.innerWidth / 2 - 150;

      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        top = rect.top - 120; // Position above the element
        left = rect.left + (rect.width / 2) - 150; // Center above the element

        // Clamp to viewport
        top = Math.max(10, top);
        left = Math.min(left, window.innerWidth - 320);
      }
      
      setSpeechBox({ visible: true, text: step.text, top, left });
      
      audioPlayer.src = step.audioSrc;
      audioPlayer.play();

      audioPlayer.onended = () => {
        currentIndex++;
        playNext();
      };
      audioPlayer.onerror = () => {
        console.error("Audio playback Error");
        setIsWalkthroughActive(false);
        setSpeechBox(prev => ({ ...prev, visible: false }));
      };
    };

    playNext();
  };

  return (
    <div className="App">
      {speechBox.visible && (
        <div className="speech-box" style={{ top: speechBox.top, left: speechBox.left }}>
          {speechBox.text}
        </div>
      )}
      <div className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <button className="new-chat-button" onClick={handleNewChat}>
          + New Chat
        </button>
        <ul className="chat-history-list">
          {chats.map((chat, index) => (
            <li
              key={chat.id}
              id={index === 0 ? 'chat-title-target' : undefined}
              className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => setActiveChatId(chat.id)}
            >
              {chat.title}
              <button className="delete-chat-button" onClick={(e) => handleDeleteChat(e, chat.id)}>
                &#x2715;
              </button>
            </li>
          ))}
        </ul>

        <div id="rag-controls" className="rag-controls">
          <input
            type="file"
            id="file-upload-input"
            multiple
            accept=".txt,text/plain"
            onChange={(e) => handleFileUpload(e.target.files!)}
          />
          <label htmlFor="file-upload-input" className="load-docs-button">
            Load Documents
          </label>
          <div className="rag-status">{ragStatus}</div>
          {loadedDocuments.length > 0 && (
            <ul className="document-list">
              {loadedDocuments.map((doc, index) => (
                <li key={index} className="document-list-item" title={doc.name}>
                  {doc.name}
                  <button
                    className="remove-doc-button"
                    onClick={() => handleRemoveDocument(doc.name)}
                  >
                    &#x2715;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div id="main-chat-area" className="main-chat-area">
        <header id="app-header" className="App-header">
          <div className="header-left">
            <button className="sidebar-toggle-button" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
              {isSidebarCollapsed ? '›' : '‹'}
            </button>
            <h1>Olivia Chatbot, Created by Zachary Kulik</h1>
          </div>
          <div className="controls-container">
            <input
              id="api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your OpenAI API Key"
            />
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o-mini</option>
              <option value="o1">o1</option>
              <option value="o4-mini">o4-mini</option>
            </select>
            {/* Mute button for speech synthesis */}
            <button id="tts-button" className="mute-button" onClick={() => setIsMuted(!isMuted)}>
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button className="walkthrough-button" onClick={startWalkthrough}>
              {isWalkthroughActive ? '■ Stop' : '▶ Walkthrough'}
            </button>
          </div>
        </header>

        <div className="chat-window" ref={chatWindowRef}>
          {activeChat ? (
            activeChat.messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <p>{msg.content}</p>
              </div>
            ))
          ) : (
            // If no chat is active, the window is simply empty.
            null
          )}
          {isLoading && (
            <div className="message assistant">
              <p>Thinking...</p>
            </div>
          )}
        </div>

        {isListening && (
          <div className="listening-popup">
            Listening... Say "send" to send your message.
          </div>
        )}

        <div className="input-container">
          {/* Microphone button for speech recognition */}
          {isSpeechRecognitionSupported && (
            <button
              id="stt-button"
              className={`mic-button ${isListening ? 'listening' : ''}`}
              onClick={toggleListen}
            >
              {isListening ? '...' : '🎤'}
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isSpeechRecognitionSupported ? "Type your message or use the microphone..." : "Type your message..."}
            disabled={isLoading}
          />
          <button onClick={handleSend} disabled={isLoading}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
