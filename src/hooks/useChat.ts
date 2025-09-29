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

      // Generate AI response using real data
      const aiResponse = await generateAIResponse(content)

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
    startNewChat,
    loadSessions
  }
}

// Generate AI responses using real equipment data
async function generateAIResponse(userMessage: string): Promise<string> {
  const message = userMessage.toLowerCase()

  // Fetch real equipment status data
  const { data: statusLogs, error } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('date', { ascending: false })
    .order('start_time', { ascending: false })

  if (error) {
    console.error('Error fetching equipment data:', error)
    return "I'm having trouble accessing the equipment data right now. Please try again in a moment."
  }

  const equipmentData = statusLogs || []
  const uniqueEquipment = [...new Set(equipmentData.map(log => log.equipment_name))]
  const totalLogs = equipmentData.length
  const downLogs = equipmentData.filter(log => log.status.toLowerCase() === 'down')
  const runningLogs = equipmentData.filter(log => log.status.toLowerCase() === 'running')

  // Calculate basic metrics
  const totalDowntime = downLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0)
  const totalRuntime = runningLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0)
  const availability = totalRuntime / (totalRuntime + totalDowntime) * 100

  if (message.includes('oee') || message.includes('overall equipment effectiveness')) {
    const recentAlerts = [...new Set(downLogs.filter(log => log.alert).map(log => log.alert))]

    return `Based on your actual equipment data analysis:

**Current OEE Performance Overview:**
• **Equipment tracked**: ${uniqueEquipment.length} machines (${uniqueEquipment.join(', ')})
• **Total operational records**: ${totalLogs} status logs
• **Calculated availability**: ${availability.toFixed(1)}%

**Recent Equipment Activity:**
• **Running periods**: ${runningLogs.length} sessions (${totalRuntime} minutes total)
• **Downtime events**: ${downLogs.length} incidents (${totalDowntime} minutes total)

**Key Issues Identified:**
${recentAlerts.length > 0 ? recentAlerts.map(alert => `• ${alert}`).join('\n') : '• No critical alerts in recent data'}

**Most Common Downtime Reasons:**
${[...new Set(downLogs.filter(log => log.reason).map(log => log.reason))]
  .slice(0, 3)
  .map(reason => `• ${reason}`)
  .join('\n')}

**Recommendations:**
1. **Focus on availability improvement** - Current ${availability.toFixed(1)}% has room for optimization
2. **Address recurring issues** - Review maintenance schedules for frequent problems
3. **Monitor alert patterns** - Implement proactive maintenance based on alert history

Would you like detailed analysis for specific equipment or time periods?`
  }

  if (message.includes('availability')) {
    const equipmentAvailability = uniqueEquipment.map(equipment => {
      const equipLogs = equipmentData.filter(log => log.equipment_name === equipment)
      const equipDowntime = equipLogs.filter(log => log.status.toLowerCase() === 'down')
        .reduce((sum, log) => sum + (log.duration_minutes || 0), 0)
      const equipRuntime = equipLogs.filter(log => log.status.toLowerCase() === 'running')
        .reduce((sum, log) => sum + (log.duration_minutes || 0), 0)
      const equipAvailability = equipRuntime / (equipRuntime + equipDowntime) * 100

      return { equipment, availability: equipAvailability, downtime: equipDowntime }
    }).sort((a, b) => b.availability - a.availability)

    return `**Availability Analysis from Real Data:**

**Equipment Availability Rankings:**
${equipmentAvailability.map((item, index) =>
  `${index + 1}. **${item.equipment}**: ${item.availability.toFixed(1)}% (${item.downtime} min downtime)`
).join('\n')}

**Downtime Analysis:**
• **Total downtime events**: ${downLogs.length}
• **Average downtime per incident**: ${totalDowntime > 0 ? (totalDowntime / downLogs.length).toFixed(1) : 0} minutes
• **Most frequent causes**: ${[...new Set(downLogs.map(log => log.reason))].slice(0, 3).join(', ')}

**Key Insights:**
• ${equipmentAvailability[0]?.equipment} is your most reliable equipment at ${equipmentAvailability[0]?.availability.toFixed(1)}%
• ${equipmentAvailability[equipmentAvailability.length - 1]?.equipment} needs attention with ${equipmentAvailability[equipmentAvailability.length - 1]?.availability.toFixed(1)}% availability

**Improvement Opportunities:**
${downLogs.filter(log => log.issue).slice(0, 3).map(log => `• Address ${log.issue} on ${log.equipment_name}`).join('\n')}

Need specific recommendations for any equipment?`
  }

  if (message.includes('downtime') || message.includes('issues')) {
    const downtimeByReason = downLogs.reduce((acc, log) => {
      const reason = log.reason || 'Unknown'
      acc[reason] = (acc[reason] || 0) + (log.duration_minutes || 0)
      return acc
    }, {} as Record<string, number>)

    const sortedDowntime = Object.entries(downtimeByReason)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)

    return `**Downtime Analysis from Actual Data:**

**Total Downtime Breakdown:**
${sortedDowntime.map(([reason, minutes]) =>
  `• **${reason}**: ${minutes} minutes (${((minutes / totalDowntime) * 100).toFixed(1)}%)`
).join('\n')}

**Recent Critical Issues:**
${downLogs.filter(log => log.issue && log.alert)
  .slice(0, 3)
  .map(log => `• **${log.equipment_name}**: ${log.issue} (${log.alert})`)
  .join('\n')}

**Equipment-Specific Concerns:**
${uniqueEquipment.map(equipment => {
  const equipDownLogs = downLogs.filter(log => log.equipment_name === equipment)
  const equipDowntime = equipDownLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0)
  return `• **${equipment}**: ${equipDowntime} min total downtime (${equipDownLogs.length} incidents)`
}).join('\n')}

**Recommendations:**
1. **Priority Focus**: Address ${sortedDowntime[0]?.[0]} issues first (${sortedDowntime[0]?.[1]} min impact)
2. **Maintenance Review**: Schedule preventive maintenance for recurring problems
3. **Alert Response**: Improve response time to critical alerts

Would you like detailed incident reports for specific equipment?`
  }

  if (message.includes('performance') || message.includes('efficiency')) {
    const avgRunDuration = runningLogs.length > 0
      ? (totalRuntime / runningLogs.length).toFixed(1)
      : '0'

    const equipmentPerformance = uniqueEquipment.map(equipment => {
      const equipRunLogs = runningLogs.filter(log => log.equipment_name === equipment)
      const avgDuration = equipRunLogs.length > 0
        ? (equipRunLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0) / equipRunLogs.length).toFixed(1)
        : '0'

      return { equipment, avgRunDuration: parseFloat(avgDuration), sessions: equipRunLogs.length }
    }).sort((a, b) => b.avgRunDuration - a.avgRunDuration)

    return `**Performance Analysis from Real Data:**

**Operating Efficiency Metrics:**
• **Total running time**: ${totalRuntime} minutes across ${runningLogs.length} sessions
• **Average run duration**: ${avgRunDuration} minutes per session
• **Equipment utilization**: ${((runningLogs.length / totalLogs) * 100).toFixed(1)}% of logged time

**Equipment Performance Rankings:**
${equipmentPerformance.map((item, index) =>
  `${index + 1}. **${item.equipment}**: ${item.avgRunDuration} min avg runtime (${item.sessions} sessions)`
).join('\n')}

**Performance Insights:**
• **Best performer**: ${equipmentPerformance[0]?.equipment} with ${equipmentPerformance[0]?.avgRunDuration} min average runs
• **Optimization opportunity**: ${equipmentPerformance[equipmentPerformance.length - 1]?.equipment} has shorter run cycles

**Operational Patterns:**
• **Most productive periods**: Review successful ${Math.max(...equipmentPerformance.map(e => e.avgRunDuration))} minute runs
• **Consistency**: ${equipmentPerformance.filter(e => e.sessions >= 3).length} machines show consistent operation patterns

**Next Steps:**
1. Analyze what makes ${equipmentPerformance[0]?.equipment} perform well
2. Apply best practices to improve shorter run durations
3. Focus on extending successful operational periods

Need specific performance optimization recommendations?`
  }

  if (message.includes('alert') || message.includes('warning')) {
    const alertTypes = [...new Set(downLogs.filter(log => log.alert).map(log => log.alert))]
    const alertsByEquipment = uniqueEquipment.map(equipment => ({
      equipment,
      alerts: downLogs.filter(log => log.equipment_name === equipment && log.alert).length
    })).filter(item => item.alerts > 0).sort((a, b) => b.alerts - a.alerts)

    return `**Alert Analysis from Real Data:**

**Alert Summary:**
• **Total alerts**: ${downLogs.filter(log => log.alert).length} across ${totalLogs} records
• **Alert types detected**: ${alertTypes.length}
• **Equipment with alerts**: ${alertsByEquipment.length} out of ${uniqueEquipment.length}

**Alert Types Identified:**
${alertTypes.map(alert => `• ${alert}`).join('\n')}

**Equipment Alert Frequency:**
${alertsByEquipment.map((item, index) =>
  `${index + 1}. **${item.equipment}**: ${item.alerts} alerts`
).join('\n')}

**Recent Critical Alerts:**
${downLogs.filter(log => log.alert && log.issue)
  .slice(0, 3)
  .map(log => `• **${log.date}**: ${log.equipment_name} - ${log.alert} (${log.issue})`)
  .join('\n')}

**Alert Response Analysis:**
• **Average alert duration**: ${downLogs.filter(log => log.alert).length > 0
  ? (downLogs.filter(log => log.alert).reduce((sum, log) => sum + (log.duration_minutes || 0), 0) /
     downLogs.filter(log => log.alert).length).toFixed(1)
  : '0'} minutes

**Recommendations:**
1. **Monitor ${alertsByEquipment[0]?.equipment}** closely - highest alert frequency
2. **Preventive maintenance** for recurring alert patterns
3. **Alert response training** to reduce resolution time

Would you like detailed alert history for specific equipment?`
  }

  // Default response with real data summary
  return `I'm analyzing your equipment performance data in real-time.

**Current Data Overview:**
• **Equipment monitored**: ${uniqueEquipment.length} machines
• **Status records**: ${totalLogs} operational logs
• **System availability**: ${availability.toFixed(1)}%
• **Active monitoring**: ${uniqueEquipment.join(', ')}

**Quick Data Insights:**
• **Most recent activity**: ${equipmentData[0]?.equipment_name} - ${equipmentData[0]?.status} (${equipmentData[0]?.date})
• **Total runtime**: ${totalRuntime} minutes
• **Downtime incidents**: ${downLogs.length} events

**What I can analyze for you:**
• **Equipment availability** and uptime analysis
• **Downtime patterns** and root cause analysis
• **Performance trends** across your equipment
• **Alert monitoring** and issue tracking
• **Operational efficiency** recommendations

**Try asking:**
• "Show me availability analysis"
• "What are the main downtime causes?"
• "Which equipment needs attention?"
• "Analyze recent alerts and issues"

What specific aspect of your equipment performance would you like to explore?`
}