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
    
    // Generate response with chart
    const response = await generateResponse(message, supabase, apiKey, isChartRequest);
    
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
          hasChart: !!response.chart
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

// Generate concise response with chart logic
async function generateResponse(message: string, supabase: any, apiKey?: string, shouldGenerateChart: boolean = false): Promise<{text: string, chart?: ChartData}> {
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
  
  // Generate chart if requested
  let chart: ChartData | undefined;
  if (shouldGenerateChart) {
    chart = await generateChart(message, equipmentData);
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
    
    return { name, availability: equipAvailability, downtime: equipDowntime };
  }).sort((a, b) => a.availability - b.availability);
  
  const worstEquipment = equipmentAnalysis[0];
  const performanceStatus = availability >= 85 ? 'Excellent' : availability >= 70 ? 'Good' : 'Poor';
  
  // Build concise response based on question type
  let responseText = '';
  
  // Pareto analysis
  if (message.toLowerCase().includes('pareto') || message.toLowerCase().includes('cause') || message.toLowerCase().includes('reason')) {
    const failureReasons: { [key: string]: number } = {};
    downLogs.forEach((log: any) => {
      if (log.reason && log.reason !== '-' && log.reason.trim() !== '') {
        failureReasons[log.reason] = (failureReasons[log.reason] || 0) + (log.duration_minutes || 0);
      }
    });
    
    const topReason = Object.entries(failureReasons).sort(([,a], [,b]) => b - a)[0];
    
    if (topReason) {
      responseText = `**Pareto Analysis Results**\n\n**Top Issue**: ${topReason[0]} (${topReason[1]} minutes)\n\n**Key Findings**:\n• ${Object.keys(failureReasons).length} failure types identified\n• Focus on ${topReason[0]} for maximum impact\n• Target: Reduce by 50% to improve overall availability\n\n**System Status**: ${availability.toFixed(1)}% availability (${performanceStatus})`;
    } else {
      responseText = `**Pareto Analysis**\n\n**Issue**: No specific failure reasons in data (all marked as "-")\n\n**Recommendation**: Update data collection to capture specific failure causes for meaningful analysis.`;
    }
  }
  // Availability analysis  
  else if (message.toLowerCase().includes('availability') || message.toLowerCase().includes('performance')) {
    responseText = `**Equipment Availability**\n\n**Overall**: ${availability.toFixed(1)}% (${performanceStatus})\n**Target**: 85% minimum\n\n**Equipment Performance**:\n${equipmentAnalysis.slice(0, 3).map(e => `• ${e.name}: ${e.availability.toFixed(1)}%`).join('\n')}\n\n**Priority**: ${worstEquipment?.name} needs attention (${worstEquipment?.availability.toFixed(1)}% availability)`;
  }
  // Downtime analysis
  else if (message.toLowerCase().includes('downtime')) {
    responseText = `**Downtime Analysis**\n\n**Total**: ${totalDowntime} minutes across ${downLogs.length} events\n**Worst Performer**: ${worstEquipment?.name} (${worstEquipment?.downtime} min downtime)\n\n**Impact**: ${((totalDowntime/(totalDowntime+totalRuntime))*100).toFixed(1)}% of total time\n**Status**: ${performanceStatus} performance level`;
  }
  // General summary
  else {
    responseText = `**System Summary**\n\n**Availability**: ${availability.toFixed(1)}% (${performanceStatus})\n**Equipment**: ${uniqueEquipment.length} monitored\n**Events**: ${downLogs.length} downtime incidents\n\n**Action Needed**: ${worstEquipment?.name} (${worstEquipment?.availability.toFixed(1)}% availability)`;
  }
  
  // Add chart note if generated
  if (chart) {
    responseText += '\n\n**Chart**: Visual analysis displayed above.';
  }
  
  return { text: responseText, chart };
}

// Generate charts based on request type
async function generateChart(query: string, equipmentData: any[]): Promise<ChartData | undefined> {
  if (!equipmentData || equipmentData.length === 0) return undefined;
  
  const lowerQuery = query.toLowerCase();
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  
  // Pareto Chart for Failure Reasons
  if (lowerQuery.includes('pareto') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
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
  if (lowerQuery.includes('availability') || lowerQuery.includes('equipment')) {
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
  
  // Downtime by Equipment
  if (lowerQuery.includes('downtime')) {
    const downtimeData = uniqueEquipment.map(name => {
      return equipmentData.filter((log: any) => 
        log.equipment_name === name && (log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive')
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    });
    
    return {
      type: 'bar',
      title: 'Downtime by Equipment (minutes)',
      labels: uniqueEquipment,
      datasets: [{
        label: 'Downtime (min)',
        data: downtimeData,
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgba(239, 68, 68, 1)',
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
