import { useState } from 'react'
import { Send, Lightbulb } from 'lucide-react'

interface ChatInputProps {
  onSendMessage: (message: string) => void
  isLoading: boolean
  onSuggestedPrompt: (prompt: string) => void
}

const SUGGESTED_PROMPTS = [
  "What's the current OEE performance across all equipment?",
  "Show me the top 3 underperforming machines this week",
  "How can I improve availability on CNC Machine 01?",
  "Explain the difference between availability, performance, and quality metrics",
  "What are the industry benchmarks for OEE in manufacturing?",
  "Generate a report on yesterday's production efficiency"
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
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-900">Suggested prompts:</span>
          </div>
          <div className="space-y-1">
            {SUGGESTED_PROMPTS.map((prompt, index) => (
              <button
                key={index}
                onClick={() => handleSuggestedPrompt(prompt)}
                className="block w-full text-left px-2 py-1 text-sm text-blue-800 hover:bg-blue-100 rounded transition-colors"
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
              ? 'bg-blue-100 text-blue-600'
              : 'hover:bg-gray-100 text-gray-600'
          }`}
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
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={!message.trim() || isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          Send
        </button>
      </form>
    </div>
  )
}