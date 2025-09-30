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
    
    // If we have a valid OpenAI key, use AI response
    if (apiKey && apiKey.startsWith('sk-') && apiKey.length > 20) {
      try {
        console.log('🤖 Generating AI response...');
        const response = await generateAIResponse(message, supabase, apiKey);
        
        // Save assistant response
        await supabase
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            role: 'assistant',
            content: response,
          });
        
        console.log('✅ AI response generated successfully');
        
        return new Response(
          JSON.stringify({ 
            response,
            debug: { mode: 'ai_powered_success' }
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
    console.log('📊 Using analytics fallback (no API key configured)...');
    const response = await generateAnalyticsResponse(message, supabase);
    
    await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: response,
      });
    
    return new Response(
      JSON.stringify({ 
        response,
        debug: { mode: 'analytics_fallback_no_key' }
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

// Generate AI response using direct OpenAI API
async function generateAIResponse(message: string, supabase: any, apiKey: string): Promise<string> {
  try {
    // Get equipment data for context
    const { data: equipmentData } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
      
    console.log(`📊 Retrieved ${equipmentData?.length || 0} equipment records`);
      
    const equipmentContext = equipmentData && equipmentData.length > 0 ? 
      `Recent Equipment Data (${equipmentData.length} records):\n${equipmentData.slice(0, 8).map((log: any) => 
        `- ${log.equipment_name}: ${log.status} on ${log.date} (${log.duration_minutes}min${log.reason ? `, Reason: ${log.reason}` : ''})`
      ).join('\n')}` : 'No recent equipment data available';
    
    const prompt = `You are an expert OEE (Overall Equipment Effectiveness) Manufacturing Copilot.

Current Equipment Status:
${equipmentContext}

User Question: ${message}

Provide a comprehensive manufacturing analysis that:
1. Uses the actual equipment data when relevant
2. Offers specific, actionable recommendations
3. Identifies patterns and improvement opportunities
4. Suggests concrete next steps
5. References industry benchmarks (World-class OEE: 85%+)

Format your response with clear sections and bullet points. Be direct and actionable.

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
            content: 'You are an expert OEE Manufacturing Copilot providing actionable insights based on real equipment data.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
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
    return `🤖 **AI-Powered OEE Analysis**\n\n${aiResponse}`;
    
  } catch (error) {
    console.error('❌ AI Response Error:', error.message);
    throw error;
  }
}

// Generate analytics response without AI
async function generateAnalyticsResponse(message: string, supabase: any): Promise<string> {
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (!equipmentData || equipmentData.length === 0) {
    return `📊 **OEE Manufacturing Assistant**

⚠️ **Current Status**: OpenAI API key not configured in environment variables

**Available Now:**
• Basic manufacturing guidance
• OEE calculation formulas
• Industry best practices
• Equipment monitoring setup

**To Enable AI Features:**
1. Configure OPENAI_API_KEY environment variable in Supabase Edge Functions
2. Import your manufacturing data via the Data Import feature
3. Ask questions about your equipment performance

**Sample Questions:**
• "Calculate OEE for [equipment name]"
• "What is world-class OEE performance?"
• "How do I reduce manufacturing downtime?"
• "Show me availability analysis"

🚀 **Next Step**: Configure OPENAI_API_KEY environment variable for advanced AI-powered insights.`;
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
  
  return `📊 **Equipment Availability Analysis**

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

## 💡 **Enable AI Features**: Configure OPENAI_API_KEY environment variable in Supabase Edge Functions for predictive insights and advanced recommendations.

**Based on your question**: "${message}"
**Analysis**: Your system shows ${availability.toFixed(1)}% availability across ${uniqueEquipment.length} machines with ${totalDowntime} minutes of total downtime. ${equipmentAnalysis[0]?.name} needs immediate attention with only ${equipmentAnalysis[0]?.availability.toFixed(1)}% availability.`;
}
