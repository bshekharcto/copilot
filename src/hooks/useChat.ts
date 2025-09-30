import { useState, useEffect } from 'react'
import { supabase, ChatSession, ChatMessage } from '../lib/supabase'

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadSessions()
  }, [])

  useEffect(() => {
    if (currentSession) {
      loadMessages(currentSession.id)
    } else {
      setMessages([])
    }
  }, [currentSession])

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

  const loadMessages = async (sessionId: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true })

    if (error) {
      console.error('Error loading messages:', error)
    } else {
      setMessages(data || [])
    }
  }

  const createNewSession = async (firstMessage?: string) => {
    const title = firstMessage
      ? firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '')
      : 'New Chat'

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ title })
      .select()
      .single()

    if (error) {
      console.error('Error creating session:', error)
      return null
    }

    const newSession = data
    setSessions(prev => [newSession, ...prev])
    setCurrentSession(newSession)
    return newSession
  }

  const sendMessage = async (content: string) => {
    if (!currentSession) {
      const session = await createNewSession(content)
      if (!session) return
    }

    setIsLoading(true)

    try {
      // Generate AI response using LangChain Edge Function
      // The Edge Function will save both user and assistant messages
      const aiResponse = await generateLangChainResponse(content, currentSession!.id)

      // Reload messages to get the latest ones from the Edge Function
      await loadMessages(currentSession!.id)

      // Update session timestamp
      await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSession!.id)

    } catch (error) {
      console.error('Error sending message:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const selectSession = (session: ChatSession) => {
    setCurrentSession(session)
  }

  const startNewChat = () => {
    setCurrentSession(null)
    setMessages([])
  }

  return {
    sessions,
    currentSession,
    messages,
    isLoading,
    sendMessage,
    selectSession,
    startNewChat,
    loadSessions
  }
}

// Generate AI responses using LangChain Edge Function
async function generateLangChainResponse(userMessage: string, sessionId: string): Promise<string> {
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oee-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        message: userMessage,
        sessionId: sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.response;
  } catch (error) {
    console.error('Error calling LangChain Edge Function:', error);

    // Fallback to basic response if LangChain fails
    return `I'm experiencing some technical difficulties accessing the advanced AI analysis. However, I can still help you analyze your equipment data.

Please try asking your question again, or you can:
• Ask about equipment availability
• Request downtime analysis
• Inquire about performance metrics
• Get alerts and issues overview

The system will attempt to restore full AI capabilities shortly.`;
  }
}