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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { message, sessionId }: ChatRequest = await req.json();
    console.log('Received chat request:', { message, sessionId });

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

    // Get equipment data for context
    const { data: equipmentData, error: equipError } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (equipError) {
      console.error('Error fetching equipment data:', equipError);
    }

    // Generate response based on equipment data
    const response = await generateIntelligentResponse(message, equipmentData || []);
    console.log('Generated response:', response.substring(0, 100) + '...');

    // Save assistant response
    const { error: assistantMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: response,
      });

    if (assistantMsgError) {
      console.error('Error saving assistant message:', assistantMsgError);
      throw new Error('Failed to save assistant message');
    }

    return new Response(
      JSON.stringify({ response }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );

  } catch (error) {
    console.error('Error in OEE Chat function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process chat request',
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

// Generate intelligent responses based on equipment data
async function generateIntelligentResponse(userMessage: string, equipmentData: any[]): Promise<string> {
  const message = userMessage.toLowerCase();
  
  // Basic analytics on equipment data
  const uniqueEquipment = [...new Set(equipmentData.map(log => log.equipment_name))];
  const totalLogs = equipmentData.length;
  const downLogs = equipmentData.filter(log => log.status?.toLowerCase() === 'down');
  const runningLogs = equipmentData.filter(log => log.status?.toLowerCase() === 'running');
  
  // Calculate metrics
  const totalDowntime = downLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
  const totalRuntime = runningLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
  const availability = totalRuntime + totalDowntime > 0 ? (totalRuntime / (totalRuntime + totalDowntime) * 100) : 0;

  if (message.includes('availability') || message.includes('uptime')) {
    // Equipment availability analysis
    const equipmentAvailability = uniqueEquipment.map(equipment => {
      const equipLogs = equipmentData.filter(log => log.equipment_name === equipment);
      const equipDowntime = equipLogs.filter(log => log.status?.toLowerCase() === 'down')
        .reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
      const equipRuntime = equipLogs.filter(log => log.status?.toLowerCase() === 'running')
        .reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
      const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;

      return { equipment, availability: equipAvailability, downtime: equipDowntime, runtime: equipRuntime };
    }).sort((a, b) => b.availability - a.availability);

    return `# Equipment Availability Analysis

**Overall System Availability: ${availability.toFixed(1)}%**

## Equipment Performance Rankings:

${equipmentAvailability.map((item, index) => 
  `${index + 1}. **${item.equipment}**: ${item.availability.toFixed(1)}% availability\n   - Runtime: ${item.runtime} minutes\n   - Downtime: ${item.downtime} minutes`
).join('\n\n')}

## Key Insights:

• **Best Performer**: ${equipmentAvailability[0]?.equipment || 'N/A'} at ${equipmentAvailability[0]?.availability.toFixed(1) || '0'}% availability
• **Needs Attention**: ${equipmentAvailability[equipmentAvailability.length - 1]?.equipment || 'N/A'} at ${equipmentAvailability[equipmentAvailability.length - 1]?.availability.toFixed(1) || '0'}% availability
• **Total Equipment**: ${uniqueEquipment.length} machines monitored
• **Data Points**: ${totalLogs} status records analyzed

## Recommendations:

1. **Focus on improving** ${equipmentAvailability[equipmentAvailability.length - 1]?.equipment || 'lower-performing equipment'}
2. **Study best practices** from ${equipmentAvailability[0]?.equipment || 'top-performing equipment'}
3. **Target 85%+ availability** for world-class OEE performance

Would you like more detailed analysis on any specific equipment?`;
  }

  if (message.includes('downtime') || message.includes('issues') || message.includes('problems')) {
    // Downtime analysis
    const downtimeByReason = downLogs.reduce((acc, log) => {
      const reason = log.reason || 'Unknown';
      acc[reason] = (acc[reason] || 0) + (log.duration_minutes || 0);
      return acc;
    }, {} as Record<string, number>);

    const sortedDowntime = Object.entries(downtimeByReason)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);

    const recentIssues = downLogs
      .filter(log => log.issue)
      .slice(0, 5)
      .map(log => `• **${log.equipment_name}**: ${log.issue} (${log.date})`);

    return `# Downtime Analysis Report

**Total Downtime: ${totalDowntime} minutes across ${downLogs.length} incidents**

## Top Downtime Causes:

${sortedDowntime.map(([reason, minutes], index) => 
  `${index + 1}. **${reason}**: ${minutes} minutes (${((minutes / totalDowntime) * 100).toFixed(1)}%)`
).join('\n')}

## Recent Critical Issues:

${recentIssues.length > 0 ? recentIssues.join('\n') : '• No specific issues recorded in recent data'}

## Equipment-Specific Downtime:

${uniqueEquipment.map(equipment => {
  const equipDownLogs = downLogs.filter(log => log.equipment_name === equipment);
  const equipDowntime = equipDownLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
  return `• **${equipment}**: ${equipDowntime} minutes (${equipDownLogs.length} incidents)`;
}).join('\n')}

## Impact Analysis:

• **Average downtime per incident**: ${downLogs.length > 0 ? (totalDowntime / downLogs.length).toFixed(1) : 0} minutes
• **Most problematic equipment**: ${downLogs.reduce((acc, log) => {
    acc[log.equipment_name] = (acc[log.equipment_name] || 0) + (log.duration_minutes || 0);
    return acc;
  }, {} as Record<string, number>)}

## Recommendations:

1. **Priority Focus**: Address "${sortedDowntime[0]?.[0] || 'main causes'}" first
2. **Preventive Maintenance**: Schedule for high-downtime equipment
3. **Root Cause Analysis**: Investigate recurring issues

Would you like detailed incident reports for specific equipment?`;
  }

  if (message.includes('oee') || message.includes('overall equipment effectiveness') || message.includes('performance')) {
    // OEE overview
    const alerts = [...new Set(downLogs.filter(log => log.alert).map(log => log.alert))];
    const avgRunDuration = runningLogs.length > 0 ? (totalRuntime / runningLogs.length) : 0;

    return `# OEE Performance Dashboard

**Current OEE Components Analysis:**

## Availability: ${availability.toFixed(1)}%
• **Target**: 90%+ (World-class benchmark)
• **Current Status**: ${availability >= 90 ? '✅ Excellent' : availability >= 80 ? '⚠️ Good' : '🔴 Needs Improvement'}
• **Uptime**: ${totalRuntime} minutes
• **Downtime**: ${totalDowntime} minutes

## Equipment Overview:
• **Machines Monitored**: ${uniqueEquipment.length}
• **Active Equipment**: ${uniqueEquipment.join(', ')}
• **Operational Records**: ${totalLogs} status logs
• **Running Sessions**: ${runningLogs.length} periods
• **Downtime Events**: ${downLogs.length} incidents

## Performance Indicators:
• **Average Run Duration**: ${avgRunDuration.toFixed(1)} minutes
• **System Utilization**: ${((runningLogs.length / totalLogs) * 100).toFixed(1)}%
• **Alert Types Active**: ${alerts.length}

## Current Alerts:
${alerts.length > 0 ? alerts.map(alert => `• ${alert}`).join('\n') : '• No active alerts detected'}

## Key Recommendations:

### Immediate Actions:
1. **Availability Focus**: Current ${availability.toFixed(1)}% vs 90% target
2. **Monitor Critical Equipment**: Address frequent downtimes
3. **Preventive Maintenance**: Based on alert patterns

### Performance Optimization:
1. **Extend Run Cycles**: Current average ${avgRunDuration.toFixed(1)} minutes
2. **Reduce Setup Times**: Minimize changeover periods
3. **Quality Improvements**: Focus on first-pass yield

## Industry Benchmarks:
• **World-Class OEE**: 85%+
• **Availability Target**: 90%
• **Performance Target**: 95%
• **Quality Target**: 99%

**Next Steps**: Would you like specific analysis for any equipment or time period?`;
  }

  // Default comprehensive response
  return `# OEE Manufacturing Copilot

**Real-time Equipment Analysis Ready**

## Current System Status:
• **Equipment Monitored**: ${uniqueEquipment.length} machines (${uniqueEquipment.join(', ')})
• **Data Points**: ${totalLogs} operational records
• **System Availability**: ${availability.toFixed(1)}%
• **Active Monitoring**: Real-time status tracking

## Recent Activity Summary:
• **Running Time**: ${totalRuntime} minutes (${runningLogs.length} sessions)
• **Downtime**: ${totalDowntime} minutes (${downLogs.length} incidents)
• **Latest Update**: ${equipmentData[0]?.equipment_name || 'No data'} - ${equipmentData[0]?.status || 'Unknown'}

## What I Can Analyze:

### 📊 **Availability Analysis**
• Equipment uptime and downtime patterns
• Availability rankings and comparisons
• Bottleneck identification

### 🔧 **Downtime & Issues**
• Root cause analysis of failures
• Maintenance requirement predictions
• Issue tracking and resolution

### 📈 **Performance Optimization**
• OEE calculations and benchmarking
• Efficiency improvement recommendations
• Production optimization strategies

### 🚨 **Alert Monitoring**
• Critical alert analysis
• Predictive maintenance alerts
• Safety and quality notifications

## Quick Start Questions:
• \"Show me availability analysis for all equipment\"
• \"What are the main causes of downtime?\"
• \"Which equipment needs immediate attention?\"
• \"Calculate our current OEE performance\"
• \"Analyze recent alerts and issues\"

**How can I help optimize your manufacturing operations today?**`;
}
