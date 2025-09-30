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
    
    console.log('✅ Response generated successfully', { hasChart: !!response.chart });
    
    return new Response(
      JSON.stringify({ 
        response: response.text,
        chart: response.chart,
        debug: { 
          mode: apiKey ? 'ai_powered' : 'analytics',
          hasChart: !!response.chart,
          chartType: response.chart?.type,
          chartTitle: response.chart?.title
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

// Generate response with improved formatting and chart logic
async function generateResponse(message: string, supabase: any, apiKey?: string, shouldGenerateChart: boolean = false): Promise<{text: string, chart?: ChartData}> {
  // Get equipment data for analysis
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
    
  console.log(`📊 Retrieved ${equipmentData?.length || 0} equipment records`);
    
  if (!equipmentData || equipmentData.length === 0) {
    return {
      text: `**OEE Manufacturing Assistant**

⚠️  **Current Status**: No equipment data available for analysis

**Available Capabilities:**
• Basic manufacturing guidance
• OEE calculation formulas
• Industry best practices
• Equipment monitoring setup

**To Enable Full Features:**
1. Import your manufacturing data via the Data Import feature
2. Ask questions about your equipment performance
3. Request charts and visualizations

**Sample Requests:**
• "Show me equipment availability chart"
• "Create a Pareto chart of failure reasons"
• "Plot downtime trends"
• "Visualize performance comparison"

🚀 **Next Step**: Import your equipment data to unlock advanced analytics and visualizations.`
    };
  }
  
  // Generate chart if requested
  let chart: ChartData | undefined;
  
  if (shouldGenerateChart) {
    console.log('📊 Generating chart for request:', message);
    chart = await generateChart(message, equipmentData);
    console.log('📊 Chart generated:', { hasChart: !!chart, type: chart?.type });
  }
  
  // Analyze equipment data for response
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
  
  // Equipment-specific analysis
  const equipmentAnalysis = uniqueEquipment.slice(0, 5).map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const equipDowntime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipRuntime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;
    
    return { 
      name, 
      availability: equipAvailability, 
      downtime: equipDowntime, 
      incidents: equipLogs.filter((log: any) => 
        log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
      ).length 
    };
  }).sort((a, b) => a.availability - b.availability);
  
  // Build response based on question type
  let responseText = '';
  
  if (message.toLowerCase().includes('pareto') || message.toLowerCase().includes('cause') || message.toLowerCase().includes('reason')) {
    // Pareto analysis response
    const failureReasons: { [key: string]: { count: number, duration: number } } = {};
    downLogs.forEach((log: any) => {
      if (log.reason && log.reason !== '-' && log.reason.trim() !== '') {
        if (!failureReasons[log.reason]) {
          failureReasons[log.reason] = { count: 0, duration: 0 };
        }
        failureReasons[log.reason].count += 1;
        failureReasons[log.reason].duration += log.duration_minutes || 0;
      }
    });
    
    const totalIssues = Object.values(failureReasons).reduce((sum, reason) => sum + reason.count, 0);
    const totalDowntimeMins = Object.values(failureReasons).reduce((sum, reason) => sum + reason.duration, 0);
    
    if (totalIssues > 0) {
      responseText = `**Manufacturing Analysis: Equipment Downtime**

#### Current Equipment Data Overview
• **Total Downtime Events**: ${downLogs.length}
• **Total Downtime Duration**: ${totalDowntime} minutes (${Math.round(totalDowntime/60)} hours and ${totalDowntime%60} minutes)
• **Equipment Monitored**: ${uniqueEquipment.length} machines
• **System Availability**: ${availability.toFixed(1)}%

#### Pareto Analysis of Downtime Reasons

Root cause analysis reveals the following breakdown of failure reasons:

${Object.entries(failureReasons)
  .sort(([,a], [,b]) => b.duration - a.duration)
  .map(([reason, data]) => 
    `• **${reason}**: ${data.duration} minutes (${data.count} events) - ${((data.duration/totalDowntimeMins)*100).toFixed(1)}% of total downtime`
  ).join('\n')}

#### Key Insights

• **Primary Focus Area**: ${Object.entries(failureReasons).sort(([,a], [,b]) => b.duration - a.duration)[0]?.[0] || 'No data'} accounts for the highest downtime impact
• **Frequency vs Impact**: Review both occurrence count and total duration for prioritization
• **Equipment Health**: ${availability >= 85 ? 'Excellent performance' : availability >= 70 ? 'Good performance with room for improvement' : 'Significant improvement needed'}

#### Actionable Recommendations

• **Immediate Action**: Address ${Object.entries(failureReasons).sort(([,a], [,b]) => b.duration - a.duration)[0]?.[0] || 'top failure cause'} which represents the highest impact
• **Process Improvement**: Implement preventive maintenance for recurring mechanical issues
• **Training Focus**: Address operator errors through targeted training programs
• **Quality Systems**: Review and strengthen quality control processes

#### Industry Benchmarks

• **World-Class OEE**: 85%+ availability target
• **Current Performance**: ${availability.toFixed(1)}% availability
• **Improvement Potential**: ${Math.max(0, 85 - availability).toFixed(1)}% points to reach world-class level`;
    } else {
      responseText = `**Manufacturing Analysis: Pareto Chart Request**

#### Current Data Status

⚠️  **Issue Identified**: No specific failure reasons available in current dataset

#### Available Data Summary
• **Total Downtime Events**: ${downLogs.length}
• **Total Downtime Duration**: ${totalDowntime} minutes
• **Equipment Monitored**: ${uniqueEquipment.length} machines

All downtime records show generic reasons ("-" or empty). For meaningful Pareto analysis, specific failure causes are needed.

#### Recommended Data Collection Improvements

• **Mechanical Issues**: Bearing failures, belt breaks, motor problems
• **Electrical Problems**: Power surges, sensor malfunctions, control issues  
• **Quality Issues**: Out-of-spec production, contamination, defects
• **Operator Factors**: Setup errors, procedure violations, training gaps
• **Material Issues**: Supply shortages, quality problems, handling damage

#### Alternative Analysis Available

• Equipment availability comparison
• Downtime duration by equipment
• Performance trend analysis
• Overall system effectiveness metrics

🔧 **Next Step**: Update data collection processes to capture specific failure reasons for comprehensive root cause analysis.`;
    }
  } else {
    // General equipment analysis response
    responseText = `**Equipment Performance Analysis**

#### System Overview
• **Overall Availability**: ${availability.toFixed(1)}% ${availability >= 85 ? '✅ Excellent' : availability >= 70 ? '⚠️ Good' : '🔴 Needs Improvement'}
• **Equipment Monitored**: ${uniqueEquipment.length} machines
• **Data Points Analyzed**: ${equipmentData.length} operational logs
• **Total Runtime**: ${totalRuntime} minutes (${Math.round(totalRuntime/60)} hours)
• **Total Downtime**: ${totalDowntime} minutes (${downLogs.length} incidents)

#### Equipment Performance Rankings

${equipmentAnalysis.map((equip, i) => 
  `• **${equip.name}**: ${equip.availability.toFixed(1)}% availability (${equip.downtime} min downtime, ${equip.incidents} incidents)`
).join('\n')}

#### Industry Benchmarks
• **World-Class OEE**: 85%+ availability required
• **Your Performance**: ${availability >= 85 ? 'Excellent - exceeds industry standards' : availability >= 70 ? 'Good - room for improvement to reach world-class' : 'Below target - significant improvement opportunity'}

#### Recommended Actions
• **Priority Equipment**: Focus on ${equipmentAnalysis[0]?.name} (lowest availability at ${equipmentAnalysis[0]?.availability.toFixed(1)}%)
• **Performance Target**: Aim for 85%+ availability across all equipment
• **Data Quality**: Ensure specific failure reasons are captured for root cause analysis

**Analysis based on your question**: "${message}"

${chart ? '\n📊 **Interactive Chart**: Visual analysis is displayed above showing the requested data breakdown.' : ''}`;
  }
  
  return {
    text: responseText,
    chart
  };
}

// Generate charts based on request type
async function generateChart(query: string, equipmentData: any[]): Promise<ChartData | undefined> {
  if (!equipmentData || equipmentData.length === 0) {
    console.log('📊 No equipment data available for chart');
    return undefined;
  }
  
  const lowerQuery = query.toLowerCase();
  console.log('📊 Processing chart request:', lowerQuery);
  
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  
  // Pareto Chart for Failure Reasons
  if (lowerQuery.includes('pareto') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
    console.log('📊 Creating Pareto chart...');
    
    const reasonCounts: { [key: string]: number } = {};
    equipmentData.forEach((log: any) => {
      if ((log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive') && 
          log.reason && log.reason !== '-' && log.reason.trim() !== '') {
        reasonCounts[log.reason] = (reasonCounts[log.reason] || 0) + 1;
      }
    });
    
    const labels = Object.keys(reasonCounts);
    const data = Object.values(reasonCounts);
    
    console.log('📊 Pareto data:', { labels, data, totalReasons: labels.length });
    
    if (labels.length === 0) {
      console.log('📊 No failure reasons found, creating empty Pareto chart');
      return {
        type: 'bar',
        title: 'Failure Reasons Analysis - No Specific Data Available',
        labels: ['No Failure Reasons Recorded'],
        datasets: [{ 
          label: 'Count', 
          data: [0], 
          backgroundColor: ['rgba(156, 163, 175, 0.8)'],
          borderColor: ['rgba(156, 163, 175, 1)'],
          borderWidth: 2
        }]
      };
    }
    
    return {
      type: 'pareto',
      title: 'Root Cause Analysis (Pareto Chart)',
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
  if (lowerQuery.includes('availability') || lowerQuery.includes('uptime') || lowerQuery.includes('equipment')) {
    console.log('📊 Creating availability chart...');
    
    const availabilityData = uniqueEquipment.map(name => {
      const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
      const downtime = equipLogs.filter((log: any) => 
        log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
      const runtime = equipLogs.filter((log: any) => 
        log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
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
        backgroundColor: availabilityData.map(val => 
          val >= 85 ? 'rgba(34, 197, 94, 0.8)' : 
          val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 
          'rgba(239, 68, 68, 0.8)'
        ),
        borderColor: availabilityData.map(val => 
          val >= 85 ? 'rgba(34, 197, 94, 1)' : 
          val >= 70 ? 'rgba(251, 191, 36, 1)' : 
          'rgba(239, 68, 68, 1)'
        ),
        borderWidth: 2
      }]
    };
  }
  
  // Downtime by Equipment
  if (lowerQuery.includes('downtime')) {
    console.log('📊 Creating downtime chart...');
    
    const downtimeData = uniqueEquipment.map(name => {
      return equipmentData.filter((log: any) => 
        log.equipment_name === name && 
        (log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive')
      ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    });
    
    return {
      type: lowerQuery.includes('pie') ? 'pie' : 'bar',
      title: 'Total Downtime by Equipment (minutes)',
      labels: uniqueEquipment,
      datasets: [{
        label: 'Downtime (min)',
        data: downtimeData,
        backgroundColor: lowerQuery.includes('pie') ? 
          ['rgba(239, 68, 68, 0.8)', 'rgba(251, 191, 36, 0.8)', 'rgba(59, 130, 246, 0.8)', 'rgba(34, 197, 94, 0.8)', 'rgba(168, 85, 247, 0.8)'] :
          'rgba(239, 68, 68, 0.8)',
        borderColor: lowerQuery.includes('pie') ? 
          ['rgba(239, 68, 68, 1)', 'rgba(251, 191, 36, 1)', 'rgba(59, 130, 246, 1)', 'rgba(34, 197, 94, 1)', 'rgba(168, 85, 247, 1)'] :
          'rgba(239, 68, 68, 1)',
        borderWidth: 2
      }]
    };
  }
  
  console.log('📊 No specific chart type detected, defaulting to availability');
  
  // Default: Equipment availability
  const availabilityData = uniqueEquipment.map(name => {
    const equipLogs = equipmentData.filter((log: any) => log.equipment_name === name);
    const downtime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'down' || log.status?.toLowerCase() === 'inactive'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
    const runtime = equipLogs.filter((log: any) => 
      log.status?.toLowerCase() === 'running' || log.status?.toLowerCase() === 'active'
    ).reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
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
      backgroundColor: availabilityData.map(val => 
        val >= 85 ? 'rgba(34, 197, 94, 0.8)' : 
        val >= 70 ? 'rgba(251, 191, 36, 0.8)' : 
        'rgba(239, 68, 68, 0.8)'
      ),
      borderColor: availabilityData.map(val => 
        val >= 85 ? 'rgba(34, 197, 94, 1)' : 
        val >= 70 ? 'rgba(251, 191, 36, 1)' : 
        'rgba(239, 68, 68, 1)'
      ),
      borderWidth: 2
    }]
  };
}
