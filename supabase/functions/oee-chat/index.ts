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
    console.log('🚀 Received chat request:', { message, sessionId });

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

    // Check OpenAI API key status
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const keyStatus = {
      exists: !!openaiApiKey,
      length: openaiApiKey ? openaiApiKey.length : 0,
      prefix: openaiApiKey ? openaiApiKey.substring(0, 7) + '...' : 'NOT_SET'
    };
    
    console.log('🔑 OpenAI key status:', keyStatus);
    
    // If no OpenAI key, provide intelligent fallback
    if (!openaiApiKey) {
      console.log('⚠️ No OpenAI key found, using intelligent fallback');
      const response = await generateIntelligentFallback(message, supabase);
      
      // Save assistant response
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
          debug: { keyStatus, mode: 'fallback' }
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }
    
    // Try to use LangChain with OpenAI
    try {
      console.log('🤖 Attempting LangChain with OpenAI...');
      const { ChatOpenAI } = await import("npm:@langchain/openai@0.2.6");
      const { PromptTemplate } = await import("npm:langchain@0.2.16/prompts");
      const { RunnableSequence } = await import("npm:@langchain/core@0.2.28/runnables");
      const { StringOutputParser } = await import("npm:@langchain/core@0.2.28/output_parsers");
      
      // Get equipment data for context
      const { data: equipmentData } = await supabase
        .from('equipment_status_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
        
      const equipmentSummary = equipmentData && equipmentData.length > 0 ? 
        `Recent Equipment Status:\n${equipmentData.slice(0, 10).map((log: any) => 
          `- ${log.equipment_name}: ${log.status} (${log.duration_minutes}min)`
        ).join('\n')}` : 'No equipment data available';
      
      // Initialize OpenAI
      const llm = new ChatOpenAI({
        openAIApiKey: openaiApiKey,
        modelName: "gpt-4o-mini",
        temperature: 0.3,
        maxTokens: 800,
      });
      
      const promptTemplate = PromptTemplate.fromTemplate(`
You are an expert OEE (Overall Equipment Effectiveness) Manufacturing Copilot.

Current Equipment Data:
{equipmentSummary}

User Question: {question}

Provide a professional manufacturing analysis with:
1. Data-driven insights from the equipment status
2. Specific OEE recommendations
3. Industry best practices
4. Actionable next steps

Keep response concise but comprehensive.

Response:
`);
      
      const chain = RunnableSequence.from([
        promptTemplate,
        llm,
        new StringOutputParser(),
      ]);
      
      const response = await chain.invoke({
        question: message,
        equipmentSummary,
      });
      
      console.log('✅ LangChain response generated successfully');
      
      // Save assistant response
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
          debug: { keyStatus, mode: 'langchain', success: true }
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
      
    } catch (langchainError) {
      console.error('❌ LangChain error:', langchainError);
      
      // Fallback to intelligent response
      const response = await generateIntelligentFallback(message, supabase);
      
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
          debug: { 
            keyStatus, 
            mode: 'fallback_after_error', 
            error: langchainError.message 
          }
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

  } catch (error) {
    console.error('❌ Error in OEE Chat function:', error);
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

// Intelligent fallback when OpenAI is not available
async function generateIntelligentFallback(userMessage: string, supabase: any): Promise<string> {
  const message = userMessage.toLowerCase();
  
  // Get equipment data
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (!equipmentData || equipmentData.length === 0) {
    return `📊 **OEE Manufacturing Copilot Ready**

⚠️ **AI Mode**: Currently running in advanced analytics mode (OpenAI integration pending)

I can still provide comprehensive manufacturing analysis including:

• **Equipment Performance Analysis**
• **OEE Calculations & Benchmarking** 
• **Downtime Root Cause Analysis**
• **Availability & Efficiency Metrics**
• **Predictive Maintenance Insights**

However, I notice you haven't imported any equipment data yet. Please:
1. Use the **Data Import** tab to upload your CSV equipment logs
2. Once data is loaded, I'll provide detailed insights on your manufacturing performance

**Sample questions I can answer once data is available:**
• "Show me availability analysis for all equipment"
• "What are the main causes of downtime?"
• "Calculate our current OEE performance"
• "Which equipment needs immediate attention?"`;
  }
  
  // Basic analytics on equipment data
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  const downLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'down');
  const runningLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'running');
  
  const totalDowntime = downLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const totalRuntime = runningLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const availability = totalRuntime + totalDowntime > 0 ? (totalRuntime / (totalRuntime + totalDowntime) * 100) : 0;
  
  if (message.includes('availability')) {
    return `📈 **Equipment Availability Analysis**

⚠️ **Mode**: Advanced Analytics (AI enhancement pending)

## Current System Performance:
• **Overall Availability**: ${availability.toFixed(1)}% 
• **Equipment Monitored**: ${uniqueEquipment.length} machines
• **Total Runtime**: ${totalRuntime} minutes
• **Total Downtime**: ${downLogs.length} incidents (${totalDowntime} minutes)

## Equipment Status:
${uniqueEquipment.map(equipment => {
  const equipLogs = equipmentData.filter((log: any) => log.equipment_name === equipment);
  const equipDowntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down')
    .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const equipRuntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'running')
    .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;
  return `• **${equipment}**: ${equipAvailability.toFixed(1)}% availability`;
}).join('\n')}

## Industry Benchmark:
• **World-class target**: 90%+
• **Your performance**: ${availability >= 90 ? '✅ Excellent' : availability >= 80 ? '⚠️ Good' : '🔴 Needs Improvement'}

**🎆 Full AI-powered insights with predictive analysis will be available once OpenAI integration is configured.**`;
  }
  
  return `📊 **OEE Manufacturing Copilot** 

⚠️ **Current Mode**: Advanced Analytics (AI enhancement pending)

## Real-time Equipment Status:
• **Machines Monitored**: ${uniqueEquipment.length} (${uniqueEquipment.join(', ')})
• **System Availability**: ${availability.toFixed(1)}%
• **Data Points**: ${equipmentData.length} operational records
• **Recent Downtime Events**: ${downLogs.length}

## Available Analysis:
• **Availability Analysis** - Equipment uptime performance
• **Downtime Tracking** - Root cause identification  
• **OEE Calculations** - Industry benchmark comparisons
• **Performance Metrics** - Efficiency measurements

## Try These Commands:
• "Show me availability analysis"
• "What equipment needs attention?"
• "Calculate downtime by equipment"
• "Show OEE performance summary"

**🎆 Enhanced AI-powered insights with predictive recommendations will be available once OpenAI integration is fully configured.**`;
}
