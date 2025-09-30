import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ChatOpenAI } from "npm:@langchain/openai@0.2.6";
import { PromptTemplate } from "npm:langchain@0.2.16/prompts";
import { RunnableSequence } from "npm:@langchain/core@0.2.28/runnables";
import { StringOutputParser } from "npm:@langchain/core@0.2.28/output_parsers";
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

    // Get equipment data for context
    const { data: equipmentData, error: equipError } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (equipError) {
      console.error('⚠️ Error fetching equipment data:', equipError);
    }
    console.log(`📊 Retrieved ${equipmentData?.length || 0} equipment records`);

    // Get OEE data for additional context
    const { data: oeeData, error: oeeError } = await supabase
      .from('oee_data')
      .select(`
        *,
        equipment:equipment_id(
          name
        )
      `)
      .order('timestamp', { ascending: false })
      .limit(50);

    if (oeeError) {
      console.log('⚠️ No OEE data available:', oeeError.message);
    }
    console.log(`📈 Retrieved ${oeeData?.length || 0} OEE records`);

    // Check if OpenAI API key is available
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('❌ OpenAI API key not found');
      throw new Error('OpenAI API key not configured');
    }
    console.log('🔑 OpenAI API key found');

    // Initialize OpenAI with LangChain
    console.log('🤖 Initializing ChatOpenAI...');
    const llm = new ChatOpenAI({
      openAIApiKey: openaiApiKey,
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 1000,
    });

    // Create equipment data summary for context
    const equipmentSummary = equipmentData && equipmentData.length > 0 ? 
      `Recent Equipment Status (last ${equipmentData.length} entries):\n${equipmentData.slice(0, 20).map((log: any) => 
        `- ${log.equipment_name}: ${log.status} on ${log.date} (Duration: ${log.duration_minutes}min${log.reason ? `, Reason: ${log.reason}` : ''}${log.issue ? `, Issue: ${log.issue}` : ''})`
      ).join('\n')}` : 'No equipment data available';

    const oeeSummary = oeeData && oeeData.length > 0 ? 
      `Recent OEE Data (last ${oeeData.length} entries):\n${oeeData.slice(0, 10).map((oee: any) => 
        `- ${oee.equipment?.name || 'Unknown'}: OEE ${(oee.oee_score * 100).toFixed(1)}% (A: ${(oee.availability * 100).toFixed(1)}%, P: ${(oee.performance * 100).toFixed(1)}%, Q: ${(oee.quality * 100).toFixed(1)}%)`
      ).join('\n')}` : 'No OEE data available';

    console.log('📝 Equipment summary created:', equipmentSummary.substring(0, 200) + '...');

    // Create comprehensive prompt template
    const promptTemplate = PromptTemplate.fromTemplate(`
You are an expert OEE (Overall Equipment Effectiveness) Manufacturing Copilot with deep expertise in:
- Manufacturing operations and equipment management  
- OEE calculations and optimization strategies
- Predictive maintenance and downtime reduction
- Production efficiency and quality improvement
- Root cause analysis for manufacturing issues
- Industry best practices and lean manufacturing
- Data analysis and trend identification

IMPORTANT: You have access to REAL manufacturing data from this facility. Use this data to provide specific, actionable insights.

Current Manufacturing Context:
{equipmentSummary}

{oeeSummary}

OEE Knowledge Base:
- OEE = Availability × Performance × Quality  
- World-class OEE benchmark: 85%+
- Availability = (Operating Time / Planned Production Time) × 100
- Performance = (Ideal Cycle Time × Total Count) / Operating Time × 100
- Quality = (Good Count / Total Count) × 100

User Question: {question}

Provide a comprehensive, expert response that:
1. Analyzes the current data context when relevant
2. Offers specific recommendations based on manufacturing best practices
3. Identifies trends, patterns, or areas for improvement
4. Suggests concrete next steps or investigations  
5. Uses professional manufacturing terminology
6. Provides quantitative insights when possible
7. References the actual data when making recommendations

Format your response with clear sections using markdown headers and bullet points for readability.

Response:
`);

    console.log('🔗 Creating LangChain sequence...');
    // Create the LangChain sequence
    const chain = RunnableSequence.from([
      promptTemplate,
      llm,
      new StringOutputParser(),
    ]);

    console.log('🧠 Invoking LangChain with OpenAI...');
    // Generate response using LangChain + OpenAI
    const response = await chain.invoke({
      question: message,
      equipmentSummary,
      oeeSummary,
    });

    console.log('✅ LangChain response generated:', response.substring(0, 150) + '...');

    // Save assistant response
    const { error: assistantMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant', 
        content: response,
      });

    if (assistantMsgError) {
      console.error('❌ Error saving assistant message:', assistantMsgError);
      throw new Error('Failed to save assistant message');
    }
    console.log('✅ Assistant message saved');

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
    console.error('❌ Error in OEE Chat function:', error);
    
    // Try to provide a helpful error response
    let errorResponse = 'I apologize, but I\'m experiencing technical difficulties.';
    
    if (error.message?.includes('OpenAI')) {
      errorResponse = 'I\'m having trouble connecting to the AI service. The OpenAI integration may need configuration.';
    } else if (error.message?.includes('API key')) {
      errorResponse = 'The AI service is not properly configured. Please check the OpenAI API key setup.';
    } else if (error.message?.includes('rate limit')) {
      errorResponse = 'I\'m currently experiencing high demand. Please try again in a moment.';
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      errorResponse = 'I\'m having network connectivity issues. Please try again shortly.';
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process chat request',
        details: error.message,
        response: `🔧 **Technical Issue Detected**\n\n${errorResponse}\n\n**Error Details**: ${error.message}\n\n**What I can still help with**:\n• Equipment status analysis\n• Basic OEE calculations\n• Downtime tracking\n• Performance monitoring\n\nPlease try again or contact support if the issue persists.`
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
