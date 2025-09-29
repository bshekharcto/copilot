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
      // Add user message
      const userMessage = {
        session_id: currentSession!.id,
        role: 'user' as const,
        content
      }

      const { data: userMsgData, error: userMsgError } = await supabase
        .from('chat_messages')
        .insert(userMessage)
        .select()
        .single()

      if (userMsgError) throw userMsgError

      setMessages(prev => [...prev, userMsgData])

      // Simulate AI response
      const aiResponse = generateAIResponse(content)

      const assistantMessage = {
        session_id: currentSession!.id,
        role: 'assistant' as const,
        content: aiResponse
      }

      const { data: assistantMsgData, error: assistantMsgError } = await supabase
        .from('chat_messages')
        .insert(assistantMessage)
        .select()
        .single()

      if (assistantMsgError) throw assistantMsgError

      setMessages(prev => [...prev, assistantMsgData])

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
    startNewChat
  }
}

// Simulate AI responses for demo purposes
function generateAIResponse(userMessage: string): string {
  const message = userMessage.toLowerCase()

  if (message.includes('oee') || message.includes('overall equipment effectiveness')) {
    return `Based on your current equipment data, I can see several key insights:

**Current OEE Performance:**
• Average OEE across all equipment: ~87.2%
• 2 machines performing above 90% (excellent)
• 1 machine needs attention with 78% OEE

**Key Recommendations:**
1. **Availability**: Focus on reducing unplanned downtime
2. **Performance**: Optimize cycle times on underperforming equipment
3. **Quality**: Maintain current quality standards while improving speed

**Specific Actions:**
• Schedule preventive maintenance for CNC Machine 01
• Review changeover procedures on Assembly Line 02
• Consider operator training for packaging efficiency

Would you like me to dive deeper into any specific aspect or equipment?`
  }

  if (message.includes('availability')) {
    return `**Availability Analysis:**

Availability measures the percentage of time equipment is operational and ready to produce.

**Current Status:**
• Best performer: Quality Scanner 04 (96.8%)
• Needs improvement: CNC Machine 01 (83.2%)

**Common availability issues:**
• Unplanned breakdowns
• Setup and changeover times
• Equipment failures
• Material shortages

**Improvement strategies:**
1. Implement predictive maintenance
2. Optimize changeover procedures
3. Ensure proper operator training
4. Maintain adequate spare parts inventory

Would you like specific recommendations for any equipment?`
  }

  if (message.includes('performance')) {
    return `**Performance Analysis:**

Performance measures how fast equipment operates compared to its designed speed.

**Current Metrics:**
• Average performance rate: 94.7%
• Top performer: Assembly Line 02 (97.1%)
• Improvement opportunity: Packaging Unit 03 (91.8%)

**Performance optimization tips:**
1. Review and optimize cycle times
2. Eliminate micro-stops and minor slowdowns
3. Ensure proper material flow
4. Regular equipment calibration

**Quick wins:**
• Adjust feed rates on slower machines
• Implement operator efficiency training
• Review material handling processes

Need help with specific equipment optimization?`
  }

  if (message.includes('quality')) {
    return `**Quality Performance Review:**

Quality measures the percentage of products that meet specifications on first pass.

**Current Quality Metrics:**
• Overall quality rate: 98.9% (excellent!)
• All equipment maintaining >98% quality
• Zero critical quality issues detected

**Quality maintenance strategies:**
1. Continue regular calibration schedules
2. Monitor process parameters closely
3. Maintain statistical process control
4. Regular operator quality training

**Best practices:**
• Document all quality procedures
• Implement error-proofing where possible
• Regular quality audits and reviews

Your quality performance is industry-leading. Great job!`
  }

  if (message.includes('trend') || message.includes('analysis')) {
    return `**Trend Analysis Summary:**

**Weekly Performance Trends:**
📈 **Improving:**
• CNC Machine 01: +2.3% OEE improvement
• Quality rates stable across all equipment

📊 **Stable:**
• Assembly Line 02: Consistent 89-91% range
• Overall availability maintaining 85%+

⚠️ **Watch Areas:**
• Packaging Unit 03: Slight performance decline (-1.8%)
• Minor increase in changeover times

**Recommendations:**
1. Investigate Packaging Unit 03 performance drop
2. Continue current improvement initiatives on CNC Machine 01
3. Benchmark best practices from high-performing equipment

**Predicted Impact:**
Following these recommendations could improve overall OEE by 3-5% within 30 days.

Would you like detailed analysis for specific equipment?`
  }

  if (message.includes('report')) {
    return `**Production Efficiency Report**

**Executive Summary:**
Yesterday's production achieved 86.4% overall OEE across 4 production lines.

**Key Metrics:**
• **Availability**: 89.2% (Target: 90%)
• **Performance**: 94.7% (Target: 95%)
• **Quality**: 99.1% (Target: 98%)

**Top Performers:**
1. Quality Scanner 04 - 92.3% OEE
2. Assembly Line 02 - 89.1% OEE

**Action Items:**
• Address availability gaps on CNC Machine 01
• Optimize cycle times on Packaging Unit 03
• Continue quality excellence initiatives

**Financial Impact:**
• Estimated production value: $247,000
• Potential improvement value: $18,000 (if reaching targets)

**Next Steps:**
Schedule maintenance review and operator training sessions.

Would you like the detailed breakdown for any specific equipment?`
  }

  // Default response
  return `I'm your OEE assistant, ready to help you analyze equipment performance and optimize manufacturing efficiency.

I can help you with:
• Equipment performance analysis
• OEE trend identification
• Improvement recommendations
• Production reports and insights
• Best practice guidance

**Quick actions you can try:**
• "Show me today's OEE performance"
• "What's causing low availability on CNC Machine 01?"
• "Generate a weekly efficiency report"
• "How can I improve overall performance?"

What would you like to explore about your equipment performance?`
}