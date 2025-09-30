import { useRef, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { DataImport } from './components/DataImport'
import { useChat } from './hooks/useChat'

function App() {
  const [showDataImport, setShowDataImport] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const {
    sessions,
    currentSession,
    messages,
    isLoading,
    sendMessage,
    selectSession,
    startNewChat,
    loadSessions
  } = useChat()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async (message: string) => {
    console.log('🎯 handleSendMessage called with:', message);
    console.log('🔄 Current loading state:', isLoading);

    if (isLoading) {
      console.log('⚠️ Click ignored - already loading');
      return;
    }

    try {
      await sendMessage(message)
      console.log('✅ handleSendMessage completed');
    } catch (error) {
      console.error('❌ handleSendMessage error:', error);
    }
  }

  const handleNewChat = () => {
    startNewChat()
  }

  const handleImportComplete = () => {
    setShowDataImport(false)
    // Optionally refresh any data or show a success message
  }


  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        currentSession={currentSession}
        onSessionSelect={selectSession}
        onNewChat={handleNewChat}
        sessions={sessions}
        onSessionsUpdate={loadSessions}
        onImportData={() => setShowDataImport(true)}
      />

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center p-8">
              <div className="text-center max-w-2xl">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#E8F2FF' }}>
                  <span className="text-2xl">🤖</span>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  OEE Assistant Ready
                </h2>
                <p className="text-gray-600 mb-8">
                  I can help you analyze equipment performance, identify trends, and provide optimization recommendations based on your actual equipment data.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                  {[
                    "Show me availability analysis for all equipment",
                    "What are the main downtime causes?",
                    "Which equipment needs immediate attention?",
                    "Generate an OEE summary report"
                  ].map((prompt, index) => (
                    <button
                      key={index}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        console.log('🖱️ Button clicked:', prompt);
                        console.log('🔄 Loading state at click:', isLoading);
                        if (!isLoading) {
                          handleSendMessage(prompt)
                        } else {
                          console.log('⚠️ Click blocked - currently loading');
                        }
                      }}
                      disabled={isLoading}
                      className="w-full p-3 text-left text-sm font-medium text-gray-900 border border-gray-200 rounded-lg transition-all duration-200 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-900 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed select-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {isLoading && currentSession === null ? '⏳ Starting chat...' : prompt}
                    </button>
                  ))}
                </div>

                <div className="text-sm text-gray-500">
                  Or ask me anything about your equipment performance, alerts, or operational insights.
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && (
                <div className="flex gap-4 p-4 bg-white">
                  <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs">AI</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 mb-2">
                      OEE Assistant
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-75"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-150"></div>
                      <span className="text-sm text-gray-500 ml-2">Analyzing...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <ChatInput
          onSendMessage={handleSendMessage}
          onSuggestedPrompt={handleSendMessage}
          isLoading={isLoading}
        />
      </div>

      {showDataImport && (
        <DataImport
          onClose={() => setShowDataImport(false)}
          onImportComplete={handleImportComplete}
        />
      )}

    </div>
  )
}

export default App
