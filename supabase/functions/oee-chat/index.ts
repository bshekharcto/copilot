import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatRequest {
  message: string;
  sessionId: string;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'pareto';
  title: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    borderWidth?: number;
    fill?: boolean;
  }[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { message, sessionId }: ChatRequest = await req.json();
    console.log('OEE Chat request:', { message: message.substring(0, 50), sessionId });

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get conversation history for context
    const { data: conversationHistory } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true })
      .limit(10); // Last 10 messages for context

    // Save user message first
    const { error: userMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: message,
      });

    if (userMsgError) {
      console.error('Error saving user message:', userMsgError);
      throw new Error('Failed to save user message');
    }

    // Get API key from environment
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    
    // Check if user is requesting a chart
    const isChartRequest = detectChartRequest(message);
    
    // Generate response with context
    const response = await generateResponseWithContext(message, conversationHistory || [], supabase, apiKey, isChartRequest);
    
    // Save assistant response
    await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: response.text,
      });
    
    return new Response(
      JSON.stringify({ 
        response: response.text,
        chart: response.chart,
        debug: { 
          mode: apiKey ? 'ai_powered' : 'analytics',
          hasChart: !!response.chart,
          contextMessages: conversationHistory?.length || 0
        }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Function execution failed',
        details: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});

// Detect if user is requesting a chart
function detectChartRequest(message: string): boolean {
  const chartKeywords = [
    'chart', 'graph', 'plot', 'visualize', 'show me', 'display',
    'bar chart', 'line chart', 'pie chart', 'trend', 'comparison',
    'pareto', 'histogram', 'visual', 'analytics'
  ];
  
  const lowerMessage = message.toLowerCase();
  return chartKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Detect contextual follow-up questions
function detectFollowUpQuestion(message: string, conversationHistory: any[]): { isFollowUp: boolean, context: string } {
  const followUpKeywords = [
    'what about', 'how about', 'and', 'also', 'tell me more', 'explain',
    'why', 'how', 'when', 'where', 'which one', 'what else',
    'more details', 'expand', 'specifically', 'elaborate',
    'it', 'that', 'this', 'they', 'those', 'these'
  ];
  
  const questionWords = ['what', 'why', 'how', 'when', 'where', 'which', 'who'];
  const lowerMessage = message.toLowerCase();
  
  // Check for follow-up indicators
  const hasFollowUpKeyword = followUpKeywords.some(keyword => lowerMessage.includes(keyword));
  const isShortQuestion = message.split(' ').length <= 5;
  const startsWithQuestionWord = questionWords.some(word => lowerMessage.startsWith(word));
  const hasPronouns = ['it', 'that', 'this', 'they', 'those', 'these'].some(pronoun => lowerMessage.includes(pronoun));
  
  const isFollowUp = hasFollowUpKeyword || (isShortQuestion && (startsWithQuestionWord || hasPronouns));
  
  // Get context from recent assistant messages
  const recentAssistantMessages = conversationHistory
    .filter(msg => msg.role === 'assistant')
    .slice(-2) // Last 2 assistant responses
    .map(msg => msg.content)
    .join(' ');
  
  return {
    isFollowUp,
    context: recentAssistantMessages
  };
}

// Determine the topic/subject from context and current message
function determineTopicFromContext(message: string, conversationHistory: any[]): string {
  const recentMessages = conversationHistory.slice(-4).map(msg => msg.content.toLowerCase()).join(' ');
  const currentMessage = message.toLowerCase();
  const combined = recentMessages + ' ' + currentMessage;
  
  // Check for specific topics in order of priority
  if (combined.includes('pareto') || combined.includes('cause') || combined.includes('reason') || combined.includes('failure')) {
    return 'pareto';
  }
  if (combined.includes('availability') || combined.includes('uptime')) {
    return 'availability';
  }
  if (combined.includes('downtime') || combined.includes('incident')) {
    return 'downtime';
  }
  if (combined.includes('equipment') || combined.includes('machine')) {
    return 'equipment';
  }
  if (combined.includes('performance') || combined.includes('efficiency')) {
    return 'performance';
  }
  
  return 'general';
}

// Generate response with conversation context
async function generateResponseWithContext(
  message: string, 
  conversationHistory: any[], 
  supabase: any, 
  apiKey?: string, 
  shouldGenerateChart: boolean = false
): Promise<{text: string, chart?: ChartData}> {
  
  // Get equipment data for analysis
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
    
  if (!equipmentData || equipmentData.length === 0) {
    return {
      text: `**No Equipment Data Available**\n\nPlease import your manufacturing data using the Data Import feature to enable analysis and charts.`
    };
  }
  
  // Check if this is a follow-up question
  const followUpInfo = detectFollowUpQuestion(message, conversationHistory);
  const topic = determineTopicFromContext(message, conversationHistory);
  
  console.log('Context info:', { 
    isFollowUp: followUpInfo.isFollowUp, 
    topic,
    messageLength: message.length,
    historyLength: conversationHistory.length 
  });
  
  // Generate chart if requested or if continuing chart-related conversation
  let chart: ChartData | undefined;
  if (shouldGenerateChart || (followUpInfo.isFollowUp && topic !== 'general')) {
    chart = await generateChart(message, equipmentData, topic);
  }
  
  // Quick analysis
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  const downLogs = equipmentData.filter((log: any) => 
    log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
  );
  const runningLogs = equipmentData.filter((log: any) => 
    log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
  );
  
  const totalDowntime = downLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const totalRuntime = runningLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const availability = totalRuntime + totalDowntime > 0 ? (totalRuntime / (totalRuntime + totalDowntime) * 100) : 0;
  
  // Equipment rankings
  const equipmentAnalysis = uniqueEquipment.map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const equipDowntime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipRuntime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;
    
    return { name, availability: equipAvailability, downtime: equipDowntime, runtime: equipRuntime };
  }).sort((a, b) => a.availability - b.availability);
  
  const worstEquipment = equipmentAnalysis[0];
  const bestEquipment = equipmentAnalysis[equipmentAnalysis.length - 1];
  const performanceStatus = availability >= 85 ? 'Excellent' : availability >= 70 ? 'Good' : 'Poor';
  
  // Build contextual response
  let responseText = '';
  
  // Handle follow-up questions with context
  if (followUpInfo.isFollowUp) {
    responseText = handleFollowUpQuestion(message, topic, {
      availability,
      performanceStatus,
      equipmentAnalysis,
      worstEquipment,
      bestEquipment,
      totalDowntime,
      downLogs,
      uniqueEquipment
    });
  } else {
    // Handle new questions
    responseText = handleNewQuestion(message, topic, {
      availability,
      performanceStatus,
      equipmentAnalysis,
      worstEquipment,
      bestEquipment,
      totalDowntime,
      downLogs,
      uniqueEquipment
    });
  }
  
  // Add chart note if generated
  if (chart) {
    responseText += '\n\n**Chart**: Visual analysis displayed above.';
  }
  
  return { text: responseText, chart };
}

// Handle follow-up questions with context
function handleFollowUpQuestion(message: string, topic: string, data: any): string {
  const lowerMessage = message.toLowerCase();
  
  // Contextual responses based on previous topic
  switch (topic) {
    case 'pareto':
      if (lowerMessage.includes('how') || lowerMessage.includes('fix') || lowerMessage.includes('improve')) {
        return `**Improvement Actions**\n\n**For Top Issue**:\n• Implement preventive maintenance schedule\n• Root cause analysis on recurring failures\n• Operator training programs\n\n**Target**: 50% reduction in failure frequency\n**Expected Impact**: +5-10% availability improvement`;
      }
      if (lowerMessage.includes('when') || lowerMessage.includes('time') || lowerMessage.includes('schedule')) {
        return `**Implementation Timeline**\n\n**Week 1-2**: Data collection improvement\n**Week 3-4**: Root cause analysis\n**Month 2**: Process changes\n**Month 3**: Results measurement\n\n**Quick Win**: Focus on most frequent failure first`;
      }
      break;
      
    case 'availability':
      if (lowerMessage.includes('improve') || lowerMessage.includes('increase') || lowerMessage.includes('better')) {
        return `**Availability Improvement Plan**\n\n**Current**: ${data.availability.toFixed(1)}%\n**Target**: 85%\n**Gap**: ${Math.max(0, 85 - data.availability).toFixed(1)} points\n\n**Focus Areas**:\n• ${data.worstEquipment.name}: Priority #1\n• Reduce unplanned downtime\n• Optimize maintenance scheduling`;
      }
      if (lowerMessage.includes('worst') || lowerMessage.includes('lowest') || lowerMessage.includes('problem')) {
        return `**Worst Performers**\n\n**Bottom 3 Equipment**:\n${data.equipmentAnalysis.slice(0, 3).map((e: any, i: number) => `${i + 1}. ${e.name}: ${e.availability.toFixed(1)}%`).join('\n')}\n\n**Primary Issue**: ${data.worstEquipment.name}\n**Action**: Investigate ${data.worstEquipment.downtime} minutes of downtime`;
      }
      break;
      
    case 'downtime':
      if (lowerMessage.includes('cost') || lowerMessage.includes('impact') || lowerMessage.includes('loss')) {
        return `**Downtime Impact**\n\n**Total Lost Time**: ${data.totalDowntime} minutes\n**Production Impact**: ${((data.totalDowntime/(data.totalDowntime+data.equipmentAnalysis.reduce((sum: number, e: any) => sum + e.runtime, 0)))*100).toFixed(1)}% of total time\n\n**Worst Equipment**: ${data.worstEquipment.name} (${data.worstEquipment.downtime} min)\n**Recovery Priority**: Focus on frequent, short incidents`;
      }
      if (lowerMessage.includes('pattern') || lowerMessage.includes('trend') || lowerMessage.includes('when')) {
        return `**Downtime Patterns**\n\n**Total Incidents**: ${data.downLogs.length}\n**Average Duration**: ${Math.round(data.totalDowntime / data.downLogs.length)} minutes\n\n**Analysis Needed**: Time-based patterns\n**Recommendation**: Track incidents by shift, day, and week`;
      }
      break;
  }
  
  // Generic follow-up responses
  if (lowerMessage.includes('more') || lowerMessage.includes('detail') || lowerMessage.includes('explain')) {
    return `**Additional Details**\n\n**System Status**: ${data.availability.toFixed(1)}% availability (${data.performanceStatus})\n**Equipment Count**: ${data.uniqueEquipment.length}\n**Focus Area**: ${data.worstEquipment.name}\n\n**Next Steps**: Specific analysis of ${data.worstEquipment.name} performance`;
  }
  
  // Default contextual response
  return `**Context Update**\n\n**Current Focus**: ${topic}\n**System Status**: ${data.performanceStatus}\n**Priority Equipment**: ${data.worstEquipment.name}\n\n**Available Actions**: Improvement analysis, cost impact, timeline planning`;
}

// Handle new questions
function handleNewQuestion(message: string, topic: string, data: any): string {
  // Pareto analysis
  if (topic === 'pareto') {
    const failureReasons: { [key: string]: number } = {};
    data.downLogs.forEach((log: any) => {
      if (log.reason && log.reason !== '-' && log.reason.trim() !== '') {
        failureReasons[log.reason] = (failureReasons[log.reason] || 0) + (log.duration_minutes || 0);
      }
    });
    
    const topReason = Object.entries(failureReasons).sort(([,a], [,b]) => b - a)[0];
    
    if (topReason) {
      return `**Pareto Analysis Results**\n\n**Top Issue**: ${topReason[0]} (${topReason[1]} minutes)\n\n**Key Findings**:\n• ${Object.keys(failureReasons).length} failure types identified\n• Focus on ${topReason[0]} for maximum impact\n• Target: Reduce by 50% to improve overall availability\n\n**System Status**: ${data.availability.toFixed(1)}% availability (${data.performanceStatus})`;
    } else {
      return `**Pareto Analysis**\n\n**Issue**: No specific failure reasons in data (all marked as "-")\n\n**Recommendation**: Update data collection to capture specific failure causes for meaningful analysis.`;
    }
  }
  // Availability analysis  
  else if (topic === 'availability' || topic === 'performance') {
    return `**Equipment Availability**\n\n**Overall**: ${data.availability.toFixed(1)}% (${data.performanceStatus})\n**Target**: 85% minimum\n\n**Equipment Performance**:\n${data.equipmentAnalysis.slice(0, 3).map((e: any) => `• ${e.name}: ${e.availability.toFixed(1)}%`).join('\n')}\n\n**Priority**: ${data.worstEquipment?.name} needs attention (${data.worstEquipment?.availability.toFixed(1)}% availability)`;
  }
  // Downtime analysis
  else if (topic === 'downtime') {
    return `**Downtime Analysis**\n\n**Total**: ${data.totalDowntime} minutes across ${data.downLogs.length} events\n**Worst Performer**: ${data.worstEquipment?.name} (${data.worstEquipment?.downtime} min downtime)\n\n**Impact**: ${((data.totalDowntime/(data.totalDowntime+data.equipmentAnalysis.reduce((sum: number, e: any) => sum + e.runtime, 0)))*100).toFixed(1)}% of total time\n**Status**: ${data.performanceStatus} performance level`;
  }
  // General summary
  else {
    return `**System Summary**\n\n**Availability**: ${data.availability.toFixed(1)}% (${data.performanceStatus})\n**Equipment**: ${data.uniqueEquipment.length} monitored\n**Events**: ${data.downLogs.length} downtime incidents\n\n**Action Needed**: ${data.worstEquipment?.name} (${data.worstEquipment?.availability.toFixed(1)}% availability)`;
  }
}

// Generate charts based on request type and context
async function generateChart(query: string, equipmentData: any[], contextTopic?: string): Promise<ChartData | undefined> {
  if (!equipmentData || equipmentData.length === 0) return undefined;
  
  const lowerQuery = query.toLowerCase();
  const topic = contextTopic || 'general';
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  
  // Use context to determine chart type if query is ambiguous
  let chartType = 'bar';
  if (topic === 'pareto' || lowerQuery.includes('pareto') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
    chartType = 'pareto';
  } else if (lowerQuery.includes('pie')) {
    chartType = 'pie';
  }
  
  // Pareto Chart for Failure Reasons
  if (chartType === 'pareto' || lowerQuery.includes('pareto') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
    const reasonCounts: { [key: string]: number } = {};
    equipmentData.forEach((log: any) => {
      if ((log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive') && 
          log.reason && log.reason !== '-' && log.reason.trim() !== '') {
        reasonCounts[log.reason] = (reasonCounts[log.reason] || 0) + 1;
      }
    });
    
    const labels = Object.keys(reasonCounts);
    const data = Object.values(reasonCounts);
    
    if (labels.length === 0) {
      return {
        type: 'bar',
        title: 'No Failure Reasons Available',
        labels: ['No Data'],
        datasets: [{ label: 'Count', data: [0], backgroundColor: ['rgba(156, 163, 175, 0.8)'] }]
      };
    }
    
    return {
      type: 'pareto',
      title: 'Failure Reasons (Pareto Chart)',
      labels,
      datasets: [{
        label: 'Failure Count',
        data,
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      }]
    };
  }
  
  // Equipment Availability Chart
  if (topic === 'availability' || lowerQuery.includes('availability') || lowerQuery.includes('equipment')) {
    const availabilityData = uniqueEquipment.map(name => {
      const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
      const downtime = equipLogs.filter((log: any) => 
        log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
      const runtime = equipLogs.filter((log: any) => 
        log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
      return runtime + downtime > 0 ? (runtime / (runtime + downtime) * 100) : 0;
    });
    
    return {
      type: chartType === 'pie' ? 'pie' : 'bar',
      title: 'Equipment Availability (%)',
      labels: uniqueEquipment,
      datasets: [{
        label: 'Availability %',
        data: availabilityData,
        backgroundColor: chartType === 'pie' ? 
          ['rgba(34, 197, 94, 0.8)', 'rgba(251, 191, 36, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(59, 130, 246, 0.8)', 'rgba(168, 85, 247, 0.8)'] :
          availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 0.8)' : val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 'rgba(239, 68, 68, 0.8)'),
        borderColor: chartType === 'pie' ? 
          ['rgba(34, 197, 94, 1)', 'rgba(251, 191, 36, 1)', 'rgba(239, 68, 68, 1)', 'rgba(59, 130, 246, 1)', 'rgba(168, 85, 247, 1)'] :
          availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 1)' : val >= 70 ? 'rgba(251, 191, 36, 1)' : 'rgba(239, 68, 68, 1)'),
        borderWidth: 2
      }]
    };
  }
  
  // Downtime by Equipment
  if (topic === 'downtime' || lowerQuery.includes('downtime')) {
    const downtimeData = uniqueEquipment.map(name => {
      return equipmentData.filter((log: any) => 
        log.equipment_name === name && (log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive')
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    });
    
    return {
      type: chartType === 'pie' ? 'pie' : 'bar',
      title: 'Downtime by Equipment (minutes)',
      labels: uniqueEquipment,
      datasets: [{
        label: 'Downtime (min)',
        data: downtimeData,
        backgroundColor: chartType === 'pie' ? 
          ['rgba(239, 68, 68, 0.8)', 'rgba(251, 191, 36, 0.8)', 'rgba(59, 130, 246, 0.8)', 'rgba(34, 197, 94, 0.8)', 'rgba(168, 85, 247, 0.8)'] :
          'rgba(239, 68, 68, 0.8)',
        borderColor: chartType === 'pie' ? 
          ['rgba(239, 68, 68, 1)', 'rgba(251, 191, 36, 1)', 'rgba(59, 130, 246, 1)', 'rgba(34, 197, 94, 1)', 'rgba(168, 85, 247, 1)'] :
          'rgba(239, 68, 68, 1)',
        borderWidth: 2
      }]
    };
  }
  
  // Default: Equipment availability
  const availabilityData = uniqueEquipment.map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const downtime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const runtime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    return runtime + downtime > 0 ? (runtime / (runtime + downtime) * 100) : 0;
  });
  
  return {
    type: 'bar',
    title: 'Equipment Availability (%)',
    labels: uniqueEquipment,
    datasets: [{
      label: 'Availability %',
      data: availabilityData,
      backgroundColor: availabilityData.map(val => 
        val >= 85 ? 'rgba(34, 197, 94, 0.8)' : val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 'rgba(239, 68, 68, 0.8)'
      ),
      borderColor: availabilityData.map(val => 
        val >= 85 ? 'rgba(34, 197, 94, 1)' : val >= 70 ? 'rgba(251, 191, 36, 1)' : 'rgba(239, 68, 68, 1)'
      ),
      borderWidth: 2
    }]
  };
}
