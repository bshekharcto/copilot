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
  console.log('🚀 Calling Edge Function with:', { userMessage, sessionId });
  console.log('🌐 Edge Function URL:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oee-chat`);

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

    console.log('📡 Response status:', response.status);
    console.log('📡 Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Response error text:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Response data received:', data);

    if (data.error) {
      throw new Error(data.error);
    }

    console.log('🎉 Returning AI response');
    return data.response;
  } catch (error) {
    console.error('❌ Error calling Edge Function:', error);
    console.error('❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    // Fallback to basic response if Edge Function fails
    return `🔧 **Debug Mode Active** - Edge Function Error Detected

**Error Details**: ${error.message}

**Fallback Response**: I'm experiencing technical difficulties with the advanced AI system. The Edge Function at \`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oee-chat\` is not responding properly.

**What I can still do**:
• Basic equipment data analysis
• Simple availability calculations
• Downtime summaries
• Alert tracking

**Debugging Info**:
- URL: ${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oee-chat
- Session: ${sessionId}
- Message: "${userMessage}"

Please check the browser console for detailed error logs or contact support.`;
  }
}