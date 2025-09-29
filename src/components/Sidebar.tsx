import { useState, useEffect } from 'react'
import { Plus, MessageSquare, Settings, BarChart3 } from 'lucide-react'
import { supabase, ChatSession } from '../lib/supabase'

interface SidebarProps {
  currentSession: ChatSession | null
  onSessionSelect: (session: ChatSession) => void
  onNewChat: () => void
}

export function Sidebar({ currentSession, onSessionSelect, onNewChat }: SidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([])

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Error loading sessions:', error)
    } else {
      setSessions(data || [])
    }
  }

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-6 h-6 text-blue-400" />
          <span className="font-semibold">OEE Copilot</span>
        </div>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Recent Chats</h3>
        <div className="space-y-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSessionSelect(session)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                currentSession?.id === session.id
                  ? 'bg-gray-700 text-white'
                  : 'hover:bg-gray-800 text-gray-300'
              }`}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="truncate text-sm">{session.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-gray-700">
        <button className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-300">
          <Settings className="w-4 h-4" />
          <span className="text-sm">Settings</span>
        </button>
      </div>
    </div>
  )
}