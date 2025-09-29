import { useState, useRef, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { OEEDashboard } from './components/OEEDashboard'
import { useChat } from './hooks/useChat'

function App() {
  const [showDashboard, setShowDashboard] = useState(true)
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
    setShowDashboard(false)
    await sendMessage(message)
  }

  const handleInsightRequest = (insight: string) => {
    setShowDashboard(false)
    sendMessage(insight)
  }

  const handleNewChat = () => {
    startNewChat()
    setShowDashboard(true)
  }

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        currentSession={currentSession}
        onSessionSelect={selectSession}
        onNewChat={handleNewChat}
        sessions={sessions}
        onSessionsUpdate={loadSessions}
      />

      <div className="flex-1 flex flex-col">
        {showDashboard && !currentSession ? (
          <OEEDashboard onInsightRequest={handleInsightRequest} />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">🤖</span>
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                      OEE Assistant Ready
                    </h2>
                    <p className="text-gray-600 mb-6">
                      I can help you analyze equipment performance, identify trends, and provide optimization recommendations.
                    </p>
                    <div className="text-sm text-gray-500">
                      Try asking about OEE metrics, equipment performance, or request insights from the dashboard.
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
          </>
        )}

        <ChatInput
          onSendMessage={handleSendMessage}
          onSuggestedPrompt={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}

export default App
