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

    // Check for OpenAI API key (only one standard variable)
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    console.log('🔑 OpenAI API key status:', {
      exists: !!openaiApiKey,
      length: openaiApiKey ? openaiApiKey.length : 0,
      isValid: openaiApiKey ? openaiApiKey.startsWith('sk-') : false
    });
    
    // If we have a valid OpenAI key, use LangChain
    if (openaiApiKey && openaiApiKey.startsWith('sk-')) {
      try {
        console.log('🤖 Using LangChain with OpenAI...');
        const response = await generateAIResponse(message, supabase, openaiApiKey);
        
        // Save assistant response
        await supabase
          .from('chat_messages')
          .insert({
            session_id: sessionId,
            role: 'assistant',
            content: response,
          });
        
        console.log('✅ AI response generated and saved');
        
        return new Response(
          JSON.stringify({ 
            response,
            debug: { mode: 'ai_powered' }
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
        
      } catch (aiError) {
        console.error('❌ LangChain error:', aiError);
        // Fall through to intelligent fallback
      }
    }
    
    // Fallback: Generate intelligent response without AI
    console.log('📊 Using intelligent fallback...');
    const response = await generateIntelligentFallback(message, supabase, !!openaiApiKey);
    
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
        debug: { mode: 'analytics_fallback' }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );

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

// Generate AI response using LangChain
async function generateAIResponse(message: string, supabase: any, apiKey: string): Promise<string> {
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
    `Recent Equipment Status (${equipmentData.length} records):\n${equipmentData.slice(0, 15).map((log: any) => 
      `- ${log.equipment_name}: ${log.status} on ${log.date} (${log.duration_minutes}min${log.reason ? `, Reason: ${log.reason}` : ''})`
    ).join('\n')}` : 'No equipment data available';
  
  // Initialize OpenAI
  const llm = new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: "gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 1000,
  });
  
  const promptTemplate = PromptTemplate.fromTemplate(`
You are an expert OEE (Overall Equipment Effectiveness) Manufacturing Copilot with deep knowledge of:
- Manufacturing operations and equipment management
- OEE calculations (Availability × Performance × Quality)
- Predictive maintenance and downtime reduction 
- Production efficiency and quality improvement
- Root cause analysis and problem solving
- Industry benchmarks (World-class OEE: 85%+)

Current Equipment Data:
{equipmentSummary}

User Question: {question}

Provide a comprehensive manufacturing analysis that:
1. Uses the actual equipment data when relevant
2. Offers specific, actionable recommendations
3. Identifies patterns and improvement opportunities  
4. Suggests concrete next steps
5. References industry benchmarks and best practices
6. Uses professional manufacturing terminology

Format your response with clear sections and bullet points for readability.

Response:
`);
  
  const chain = RunnableSequence.from([
    promptTemplate,
    llm,
    new StringOutputParser(),
  ]);
  
  return await chain.invoke({
    question: message,
    equipmentSummary,
  });
}

// Generate intelligent response without AI
async function generateIntelligentFallback(message: string, supabase: any, keyExists: boolean): Promise<string> {
  const userMessage = message.toLowerCase();
  
  // Get equipment data
  const { data: equipmentData } = await supabase
    .from('equipment_status_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (!equipmentData || equipmentData.length === 0) {
    return `📊 **OEE Manufacturing Copilot**

⚠️ **Status**: ${keyExists ? 'OpenAI key found but not working' : 'OpenAI API key not configured'}

**Current Situation:**
• ${keyExists ? 'OpenAI integration encountering issues' : 'OPENAI_API_KEY environment variable not set'}
• No equipment data available for analysis

**To Enable Full AI Capabilities:**
1. **Configure OPENAI_API_KEY** in Supabase Edge Function environment
2. **Import Equipment Data** using the Data Import tab
3. **Test the chat** to verify AI integration

**What I can provide without AI:**
• Basic equipment data analysis
• OEE calculation assistance  
• Manufacturing best practices
• Industry benchmarks

**Next Steps:**
1. Set the OPENAI_API_KEY environment variable with your OpenAI API key
2. Upload your manufacturing data via the Data Import feature
3. Once configured, I'll provide advanced AI-powered insights`;
  }
  
  // Basic analytics
  const uniqueEquipment = [...new Set(equipmentData.map((log: any) => log.equipment_name))];
  const downLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'down');
  const runningLogs = equipmentData.filter((log: any) => log.status?.toLowerCase() === 'running');
  const totalDowntime = downLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const totalRuntime = runningLogs.reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const availability = totalRuntime + totalDowntime > 0 ? (totalRuntime / (totalRuntime + totalDowntime) * 100) : 0;
  
  if (userMessage.includes('availability') || userMessage.includes('uptime')) {
    return `📈 **Equipment Availability Analysis**

⚠️ **Mode**: Data Analytics ${keyExists ? '(AI integration issues)' : '(OpenAI key needed)'}

## Current System Performance:
• **Overall Availability**: ${availability.toFixed(1)}% ${availability >= 90 ? '✅ Excellent' : availability >= 80 ? '⚠️ Good' : '🔴 Needs Improvement'}
• **Equipment Monitored**: ${uniqueEquipment.length} machines
• **Active Equipment**: ${uniqueEquipment.join(', ')}
• **Total Runtime**: ${totalRuntime} minutes (${runningLogs.length} sessions)
• **Total Downtime**: ${totalDowntime} minutes (${downLogs.length} incidents)

## Equipment Rankings:
${uniqueEquipment.map(equipment => {
  const equipLogs = equipmentData.filter((log: any) => log.equipment_name === equipment);
  const equipDowntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'down')
    .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const equipRuntime = equipLogs.filter((log: any) => log.status?.toLowerCase() === 'running')
    .reduce((sum: number, log: any) => sum + (log.duration_minutes || 0), 0);
  const equipAvailability = equipRuntime + equipDowntime > 0 ? (equipRuntime / (equipRuntime + equipDowntime) * 100) : 0;
  return `• **${equipment}**: ${equipAvailability.toFixed(1)}% availability (${equipDowntime}min downtime)`;
}).join('\n')}

## Industry Benchmarks:
• **World-class OEE**: 85%+ (requires 90%+ availability)
• **Your Current Level**: ${availability >= 90 ? 'World-class' : availability >= 80 ? 'Above Average' : 'Improvement Needed'}

🎆 **Enable AI Features**: Set OPENAI_API_KEY environment variable for predictive insights and advanced recommendations.`;
  }
  
  return `📊 **OEE Manufacturing Copilot** 

⚠️ **Current Mode**: Advanced Data Analytics
🎆 **AI Enhancement**: ${keyExists ? 'Key found but integration issues' : 'Requires OPENAI_API_KEY configuration'}

## Your Manufacturing System:
• **Equipment Monitored**: ${uniqueEquipment.length} machines (${uniqueEquipment.join(', ')})
• **System Availability**: ${availability.toFixed(1)}% ${availability >= 85 ? '✅' : '🔴'}
• **Data Records**: ${equipmentData.length} operational logs analyzed
• **Recent Downtime**: ${downLogs.length} incidents (${totalDowntime} minutes)

## What I Can Analyze:
• **Equipment Availability** - Uptime/downtime performance
• **OEE Calculations** - Industry benchmark comparisons  
• **Downtime Analysis** - Pattern identification
• **Performance Metrics** - Efficiency measurements

## Available Commands:
• "Show me availability analysis"
• "Calculate OEE performance" 
• "Which equipment needs attention?"
• "Analyze downtime patterns"

## 🎆 Enable Full AI Capabilities:
**Set OPENAI_API_KEY environment variable** to unlock:
• Predictive maintenance recommendations
• Advanced root cause analysis
• Personalized optimization strategies
• Natural language insights
• Automated problem diagnosis

**Configuration Required**: OPENAI_API_KEY environment variable in Supabase Edge Function`;
}
