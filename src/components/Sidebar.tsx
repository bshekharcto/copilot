import { useState, useEffect } from 'react'
import { Plus, MessageSquare, Settings, BarChart3, Trash2, Edit3, Upload } from 'lucide-react'
import { supabase, ChatSession } from '../lib/supabase'

interface SidebarProps {
  currentSession: ChatSession | null
  onSessionSelect: (session: ChatSession) => void
  onNewChat: () => void
  sessions: ChatSession[]
  onSessionsUpdate: () => void
  onImportData: () => void
}

export function Sidebar({ currentSession, onSessionSelect, onNewChat, sessions, onSessionsUpdate, onImportData }: SidebarProps) {
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this chat?')) return

    // Delete all messages first
    await supabase
      .from('chat_messages')
      .delete()
      .eq('session_id', sessionId)

    // Delete the session
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId)

    if (error) {
      console.error('Error deleting session:', error)
    } else {
      // If we're deleting the current session, clear it
      if (currentSession?.id === sessionId) {
        onNewChat()
      }
      onSessionsUpdate()
    }
  }

  const startEdit = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSession(session.id)
    setEditTitle(session.title)
  }

  const saveEdit = async (sessionId: string) => {
    if (!editTitle.trim()) return

    const { error } = await supabase
      .from('chat_sessions')
      .update({ title: editTitle.trim() })
      .eq('id', sessionId)

    if (error) {
      console.error('Error updating session:', error)
    } else {
      setEditingSession(null)
      onSessionsUpdate()
    }
  }

  const handleEditKeyPress = (e: React.KeyboardEvent, sessionId: string) => {
    if (e.key === 'Enter') {
      saveEdit(sessionId)
    } else if (e.key === 'Escape') {
      setEditingSession(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 24) {
      return 'Today'
    } else if (diffInHours < 48) {
      return 'Yesterday'
    } else if (diffInHours < 168) { // 7 days
      return `${Math.floor(diffInHours / 24)} days ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  // Group sessions by date
  const groupedSessions = sessions.reduce((groups, session) => {
    const dateKey = formatDate(session.updated_at)
    if (!groups[dateKey]) {
      groups[dateKey] = []
    }
    groups[dateKey].push(session)
    return groups
  }, {} as Record<string, ChatSession[]>)

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-6 h-6" style={{ color: '#1955AE' }} />
          <span className="font-semibold">OEE Copilot</span>
        </div>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
          style={{
            backgroundColor: '#1955AE',
            color: 'white'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#164A99'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1955AE'}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(groupedSessions).map(([dateGroup, groupSessions]) => (
          <div key={dateGroup} className="mb-4">
            <h3 className="text-xs font-medium text-gray-400 mb-2 px-2 sticky top-0 bg-gray-900">
              {dateGroup}
            </h3>
            <div className="space-y-1">
              {groupSessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative rounded-lg transition-colors ${
                    currentSession?.id === session.id
                      ? 'bg-gray-700'
                      : 'hover:bg-gray-800'
                  }`}
                  onMouseEnter={() => setHoveredSession(session.id)}
                  onMouseLeave={() => setHoveredSession(null)}
                >
                  <button
                    onClick={() => onSessionSelect(session)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 rounded-lg"
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    {editingSession === session.id ? (
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => saveEdit(session.id)}
                        onKeyDown={(e) => handleEditKeyPress(e, session.id)}
                        className="flex-1 bg-transparent border-none outline-none text-sm text-white"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate text-sm text-gray-200">
                        {session.title}
                      </span>
                    )}
                  </button>

                  {hoveredSession === session.id && editingSession !== session.id && (
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                      <button
                        onClick={(e) => startEdit(session, e)}
                        className="p-1 rounded hover:bg-gray-600 transition-colors"
                        title="Rename"
                      >
                        <Edit3 className="w-3 h-3 text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => deleteSession(session.id, e)}
                        className="p-1 rounded hover:bg-gray-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {sessions.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            No chat history yet.
            <br />
            Start a conversation!
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-700 space-y-2">
        <button
          onClick={onImportData}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-300"
        >
          <Upload className="w-4 h-4" />
          <span className="text-sm">Import Data</span>
        </button>
        <button className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-300">
          <Settings className="w-4 h-4" />
          <span className="text-sm">Settings</span>
        </button>
      </div>
    </div>
  )
}