import { useState } from 'react'
import { Send, Lightbulb } from 'lucide-react'

interface ChatInputProps {
  onSendMessage: (message: string) => void
  isLoading: boolean
  onSuggestedPrompt: (prompt: string) => void
}

const SUGGESTED_PROMPTS = [
  "Show me availability analysis for all equipment",
  "What are the main downtime causes across my machines?",
  "Which equipment needs immediate attention?",
  "Analyze recent alerts and critical issues",
  "Show me performance trends for Machine A vs Machine B",
  "What caused the longest downtime incident?",
  "Generate an OEE summary report",
  "How can I reduce maintenance-related downtime?"
]

export function ChatInput({ onSendMessage, isLoading, onSuggestedPrompt }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (message.trim() && !isLoading) {
      onSendMessage(message.trim())
      setMessage('')
      setShowSuggestions(false)
    }
  }

  const handleSuggestedPrompt = (prompt: string) => {
    onSuggestedPrompt(prompt)
    setShowSuggestions(false)
  }

  return (
    <div className="border-t bg-white p-4">
      {showSuggestions && (
        <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: '#E8F2FF' }}>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4" style={{ color: '#1955AE' }} />
            <span className="text-sm font-medium" style={{ color: '#1955AE' }}>Suggested prompts:</span>
          </div>
          <div className="space-y-1">
            {SUGGESTED_PROMPTS.map((prompt, index) => (
              <button
                key={index}
                onClick={() => handleSuggestedPrompt(prompt)}
                className="block w-full text-left px-2 py-1 text-sm rounded transition-colors"
                style={{ color: '#164A99' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#D1E7FF'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowSuggestions(!showSuggestions)}
          className={`p-2 rounded-lg transition-colors ${
            showSuggestions
              ? 'hover:bg-gray-100 text-gray-600'
              : 'hover:bg-gray-100 text-gray-600'
          }`}
          style={{
            backgroundColor: showSuggestions ? '#E8F2FF' : 'transparent',
            color: showSuggestions ? '#1955AE' : '#6B7280'
          }}
          title="Show suggested prompts"
        >
          <Lightbulb className="w-5 h-5" />
        </button>

        <div className="flex-1 relative">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask about OEE metrics, equipment performance, or get insights..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none"
            style={{
              focusRingColor: '#1955AE'
            }}
            onFocus={(e) => e.target.style.borderColor = '#1955AE'}
            onBlur={(e) => e.target.style.borderColor = '#D1D5DB'}
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={!message.trim() || isLoading}
          className="px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          style={{
            backgroundColor: '#1955AE'
          }}
          onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = '#164A99')}
          onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = '#1955AE')}
        >
          <Send className="w-4 h-4" />
          Send
        </button>
      </form>
    </div>
  )
}