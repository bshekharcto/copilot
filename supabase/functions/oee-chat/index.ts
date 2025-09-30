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
    console.log('🚀 OEE Chat request:', { message: message.substring(0, 50), sessionId });

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Save user message first
    const { error: userMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: message,
      });

    if (userMsgError) {
      console.error('❌ Error saving user message:', userMsgError);
      throw new Error('Failed to save user message');
    }
    console.log('✅ User message saved');

    // Get API key from environment
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    
    console.log('🔑 API Key status:', {
      hasKey: !!apiKey,
      isValid: apiKey ? apiKey.startsWith('sk-') && apiKey.length > 20 : false
    });
    
    // Check if user is requesting a chart
    const isChartRequest = detectChartRequest(message);
    console.log('📊 Chart request detected:', isChartRequest);
    
    // If we have a valid OpenAI key, use AI response
    if (apiKey && apiKey.startsWith('sk-') && apiKey.length > 20) {
      try {
        console.log('🤖 Generating AI response...');
        const response = await generateAIResponse(message, supabase, apiKey, isChartRequest);
        
        // Save assistant response
        await supabase
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            role: 'assistant',
            content: response.text,
          });
        
        console.log('✅ AI response generated successfully');
        
        return new Response(
          JSON.stringify({ 
            response: response.text,
            chart: response.chart,
            debug: { mode: 'ai_powered_success', hasChart: !!response.chart }
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
        
      } catch (aiError) {
        console.error('❌ AI generation failed:', aiError.message);
        // Fall through to fallback
      }
    }
    
    // Fallback: Use analytics mode
    console.log('📊 Using analytics fallback...');
    const response = await generateAnalyticsResponse(message, supabase, isChartRequest);
    
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
        debug: { mode: 'analytics_fallback', hasChart: !!response.chart }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );

  } catch (error) {
    console.error('❌ Function error:', error);
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

// Generate AI response using direct OpenAI API
async function generateAIResponse(message: string, supabase: any, apiKey: string, shouldGenerateChart: boolean): Promise<{text: string, chart?: ChartData}> {
  try {
    // Get equipment data for context
    const { data: equipmentData } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
      
    console.log(`📊 Retrieved ${equipmentData?.length || 0} equipment records`);
    
    const equipmentContext = equipmentData && equipmentData.length > 0 ? 
      `Recent Equipment Data (${equipmentData.length} records):\n${equipmentData.slice(0, 10).map((log: any) => 
        `- ${log.equipment_name}: ${log.status} on ${log.date} (${log.duration_minutes}min${log.reason ? `, Reason: ${log.reason}` : ''})`
      ).join('\n')}` : 'No recent equipment data available';
    
    const chartInstructions = shouldGenerateChart ? `

IMPORTANT: The user is requesting a chart/visualization. Based on the equipment data and user question, suggest what type of chart would be most appropriate and what data should be displayed. Include specific chart recommendations in your response using this format:

[CHART_SUGGESTION]
Type: [bar/line/pie/doughnut/pareto]
Title: [Chart title]
Description: [What the chart shows]
[/CHART_SUGGESTION]

Examples:
- Equipment downtime comparison: bar chart
- Availability trends over time: line chart  
- Downtime causes breakdown: pie chart
- Root cause analysis: pareto chart` : '';
    
    const prompt = `You are an expert OEE (Overall Equipment Effectiveness) Manufacturing Copilot with advanced data visualization capabilities.

Current Equipment Status:
${equipmentContext}

User Question: ${message}

Provide a comprehensive manufacturing analysis that:
1. Uses the actual equipment data when relevant
2. Offers specific, actionable recommendations
3. Identifies patterns and improvement opportunities
4. Suggests concrete next steps
5. References industry benchmarks (World-class OEE: 85%+)
6. When appropriate, recommends data visualizations

Format your response with clear sections and bullet points. Be direct and actionable.${chartInstructions}

Response:`;
    
    console.log('🤖 Calling OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert OEE Manufacturing Copilot with data visualization capabilities. Provide actionable insights and chart recommendations when appropriate.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1200,
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorData);
      throw new Error(`OpenAI API Error: ${response.status} - ${errorData}`);
    }
    
    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;
    
    if (!aiResponse) {
      throw new Error('No response from OpenAI');
    }
    
    console.log('✅ OpenAI response received');
    
    // Extract chart suggestion and generate chart if present
    let chart: ChartData | undefined;
    let cleanedResponse = aiResponse;
    
    if (shouldGenerateChart && equipmentData && equipmentData.length > 0) {
      chart = await generateChartFromResponse(aiResponse, equipmentData);
      // Remove chart suggestion markup from response
      cleanedResponse = aiResponse.replace(/\[CHART_SUGGESTION\][\s\S]*?\[\/CHART_SUGGESTION\]/g, '').trim();
    }
    
    return {
      text: `🤖 **AI-Powered OEE Analysis**\n\n${cleanedResponse}`,
      chart
    };
    
  } catch (error) {
    console.error('❌ AI Response Error:', error.message);
    throw error;
  }
}

// Generate analytics response without AI
async function generateAnalyticsResponse(message: string, supabase: any, shouldGenerateChart: boolean): Promise<{text: string, chart?: ChartData}> {
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (!equipmentData || equipmentData.length === 0) {
    return {
      text: `📊 **OEE Manufacturing Assistant**

⚠️ **Current Status**: OpenAI API key not configured in environment variables

**Available Now:**
• Basic manufacturing guidance
• OEE calculation formulas
• Industry best practices
• Equipment monitoring setup
• Chart generation when data is available

**Chart Capabilities:**
• Equipment availability bar charts
• Downtime trend analysis
• Root cause Pareto charts
• Performance comparison charts

**To Enable AI Features:**
1. Configure OPENAI_API_KEY environment variable in Supabase Edge Functions
2. Import your manufacturing data via the Data Import feature
3. Ask questions about your equipment performance

**Sample Chart Requests:**
• "Show me a chart of equipment availability"
• "Plot downtime trends for last month"
• "Create a Pareto chart of failure reasons"
• "Visualize equipment performance comparison"

🚀 **Next Step**: Configure OPENAI_API_KEY environment variable for advanced AI-powered insights.`
    };
  }
  
  // Generate chart if requested
  let chart: ChartData | undefined;
  if (shouldGenerateChart) {
    chart = await generateBasicChart(message, equipmentData);
  }
  
  // Analyze equipment data
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  const downLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'down');
  const runningLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'running');
  const totalDowntime = downLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const totalRuntime = runningLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const availability = totalRuntime + totalDowntime > 0 ? (totalRuntime / (totalRuntime + totalDowntime) * 100) : 0;
  
  // Equipment-specific analysis
  const equipmentAnalysis = uniqueEquipment.slice(0, 5).map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const equipDowntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down')
      .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipRuntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'running')
      .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;
    
    return { name, availability: equipAvailability, downtime: equipDowntime, incidents: equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down').length };
  }).sort((a, b) => a.availability - b.availability);
  
  const chartNote = chart ? '\n\n📊 **Chart Generated**: Visual analysis is displayed above.' : '';
  
  return {
    text: `📊 **Equipment Availability Analysis**

🎯 **Mode**: Data Analytics (OPENAI_API_KEY environment variable not configured)

## 📈 Current System Performance:
• **Overall Availability**: ${availability.toFixed(1)}% ${availability >= 85 ? '✅ Excellent' : availability >= 70 ? '⚠️ Good' : '🔴 Needs Improvement'}
• **Equipment Monitored**: ${uniqueEquipment.length} machines
• **Active Data Points**: ${equipmentData.length} operational logs
• **Total Runtime**: ${totalRuntime} minutes (${Math.round(totalRuntime/60)} hours)
• **Total Downtime**: ${totalDowntime} minutes (${downLogs.length} incidents)

## 🗐️ Equipment Rankings:
${equipmentAnalysis.map((equip, i) => 
  `• **${equip.name}**: ${equip.availability.toFixed(1)}% availability (${equip.downtime}min downtime)`
).join('\n')}

## 🏆 Industry Benchmarks:
• **World-class OEE**: 85%+ (requires 90%+ availability)
• **Your Current Level**: ${availability >= 85 ? 'Excellent' : availability >= 70 ? 'Good' : 'Improvement Needed'}

## 📊 Chart Capabilities Available:
• "Show me equipment availability chart"
• "Plot downtime by equipment"
• "Create failure reason Pareto chart"
• "Visualize performance trends"

## 💡 **Enable AI Features**: Configure OPENAI_API_KEY environment variable for advanced predictive insights and intelligent chart recommendations.

**Based on your question**: "${message}"
**Analysis**: Your system shows ${availability.toFixed(1)}% availability across ${uniqueEquipment.length} machines with ${totalDowntime} minutes of total downtime. ${equipmentAnalysis[0]?.name} needs immediate attention with only ${equipmentAnalysis[0]?.availability.toFixed(1)}% availability.${chartNote}`,
    chart
  };
}

// Generate chart from AI response suggestions
async function generateChartFromResponse(aiResponse: string, equipmentData: any[]): Promise<ChartData | undefined> {
  const chartSuggestionMatch = aiResponse.match(/\[CHART_SUGGESTION\]([\s\S]*?)\[\/CHART_SUGGESTION\]/);
  
  if (!chartSuggestionMatch) {
    // If no specific suggestion, generate a default availability chart
    return generateBasicChart('equipment availability', equipmentData);
  }
  
  const suggestion = chartSuggestionMatch[1];
  const typeMatch = suggestion.match(/Type: (\w+)/);
  const titleMatch = suggestion.match(/Title: (.+)/);
  
  const chartType = (typeMatch?.[1] || 'bar') as ChartData['type'];
  const chartTitle = titleMatch?.[1]?.trim() || 'Equipment Analysis';
  
  // Generate chart based on type and title
  return generateBasicChart(chartTitle, equipmentData, chartType);
}

// Generate basic charts from equipment data
async function generateBasicChart(query: string, equipmentData: any[], chartType?: ChartData['type']): Promise<ChartData | undefined> {
  if (!equipmentData || equipmentData.length === 0) return undefined;
  
  const lowerQuery = query.toLowerCase();
  
  // Determine chart type if not specified
  if (!chartType) {
    if (lowerQuery.includes('trend') || lowerQuery.includes('time') || lowerQuery.includes('over')) {
      chartType = 'line';
    } else if (lowerQuery.includes('pie') || lowerQuery.includes('breakdown') || lowerQuery.includes('distribution')) {
      chartType = 'pie';
    } else if (lowerQuery.includes('pareto') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
      chartType = 'pareto';
    } else {
      chartType = 'bar';
    }
  }
  
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  
  // Equipment Availability Chart
  if (lowerQuery.includes('availability') || lowerQuery.includes('uptime')) {
    const availabilityData = uniqueEquipment.map(name => {
      const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
      const downtime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down')
        .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
      const runtime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'running')
        .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
      const availability = runtime + downtime > 0 ? (runtime / (runtime + downtime) * 100) : 0;
      return availability;
    });
    
    return {
      type: chartType === 'line' ? 'line' : 'bar',
      title: 'Equipment Availability (%)',
      labels: uniqueEquipment,
      datasets: [{
        label: 'Availability %',
        data: availabilityData,
        backgroundColor: availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 0.8)' : val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 'rgba(239, 68, 68, 0.8)'),
        borderColor: availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 1)' : val >= 70 ? 'rgba(251, 191, 36, 1)' : 'rgba(239, 68, 68, 1)'),
        borderWidth: 2
      }]
    };
  }
  
  // Downtime by Equipment
  if (lowerQuery.includes('downtime') && (lowerQuery.includes('equipment') || lowerQuery.includes('machine'))) {
    const downtimeData = uniqueEquipment.map(name => {
      return equipmentData.filter((log: any) => log.equipment_name === name && log.status?.toLowerCase() === 'down')
        .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    });
    
    return {
      type: chartType === 'pie' ? 'pie' : 'bar',
      title: 'Total Downtime by Equipment (minutes)',
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
  
  // Failure Reasons Pareto Chart
  if (lowerQuery.includes('reason') || lowerQuery.includes('cause') || lowerQuery.includes('pareto')) {
    const reasonCounts: { [key: string]: number } = {};
    equipmentData.forEach((log: any) => {
      if (log.status?.toLowerCase() === 'down' && log.reason) {
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
        datasets: [{ label: 'Count', data: [0], backgroundColor: 'rgba(156, 163, 175, 0.8)' }]
      };
    }
    
    return {
      type: 'pareto',
      title: 'Failure Reasons Analysis (Pareto Chart)',
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
  
  // Default: Equipment availability
  const availabilityData = uniqueEquipment.map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const downtime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down')
      .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const runtime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'running')
      .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const availability = runtime + downtime > 0 ? (runtime / (runtime + downtime) * 100) : 0;
    return availability;
  });
  
  return {
    type: 'bar',
    title: 'Equipment Availability (%)',
    labels: uniqueEquipment,
    datasets: [{
      label: 'Availability %',
      data: availabilityData,
      backgroundColor: availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 0.8)' : val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 'rgba(239, 68, 68, 0.8)'),
      borderColor: availabilityData.map(val => val >= 85 ? 'rgba(34, 197, 94, 1)' : val >= 70 ? 'rgba(251, 191, 36, 1)' : 'rgba(239, 68, 68, 1)'),
      borderWidth: 2
    }]
  };
}
