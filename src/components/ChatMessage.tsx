import { Bot, User } from 'lucide-react'
import { ChatMessage as ChatMessageType } from '../lib/supabase'
import { Chart, ChartData } from './Chart'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  // Check if message contains chart data
  const parseMessageContent = (content: string) => {
    try {
      // Look for chart data markers in the message
      const chartMarker = '```chart:'
      const chartEndMarker = '```'

      if (content.includes(chartMarker)) {
        const chartStart = content.indexOf(chartMarker) + chartMarker.length
        const chartEnd = content.indexOf(chartEndMarker, chartStart)

        if (chartEnd > chartStart) {
          const chartDataStr = content.substring(chartStart, chartEnd).trim()
          const chartData = JSON.parse(chartDataStr) as ChartData
          const textBefore = content.substring(0, content.indexOf(chartMarker)).trim()
          const textAfter = content.substring(chartEnd + chartEndMarker.length).trim()

          return {
            hasChart: true,
            chartData,
            textBefore,
            textAfter
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse chart data:', error)
    }

    return {
      hasChart: false,
      text: content
    }
  }

  const parsedContent = parseMessageContent(message.content)

  return (
    <div className={`flex gap-4 p-4 ${isUser ? 'bg-gray-50' : 'bg-white'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-blue-600' : 'bg-gray-700'
      }`}>
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 mb-1">
          {isUser ? 'You' : 'OEE Assistant'}
        </div>

        {parsedContent.hasChart ? (
          <div className="space-y-4">
            {parsedContent.textBefore && (
              <div className="text-gray-700 whitespace-pre-wrap">{parsedContent.textBefore}</div>
            )}

            <Chart chartData={parsedContent.chartData!} />

            {parsedContent.textAfter && (
              <div className="text-gray-700 whitespace-pre-wrap">{parsedContent.textAfter}</div>
            )}
          </div>
        ) : (
          <div className="text-gray-700 whitespace-pre-wrap">{parsedContent.text}</div>
        )}

        <div className="text-xs text-gray-500 mt-2">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}