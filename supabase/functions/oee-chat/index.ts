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

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get equipment data for context
    const { data: equipmentData } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    // Get OEE data for context
    const { data: oeeData } = await supabase
      .from('oee_data')
      .select(`
        *,
        equipment:equipment_id(
          name
        )
      `)
      .order('timestamp', { ascending: false })
      .limit(50);

    // Initialize OpenAI with LangChain
    const llm = new ChatOpenAI({
      openAIApiKey: Deno.env.get('OPENAI_API_KEY'),
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });

    // Create equipment data summary for context
    const equipmentSummary = equipmentData ? 
      `Recent Equipment Status (last 100 entries):\n${equipmentData.map(log => 
        `- ${log.equipment_name}: ${log.status} on ${log.date} (Duration: ${log.duration_minutes}min${log.reason ? `, Reason: ${log.reason}` : ''})`
      ).slice(0, 20).join('\n')}` : 'No equipment data available';

    const oeeSummary = oeeData ? 
      `Recent OEE Data (last 50 entries):\n${oeeData.map(oee => 
        `- ${oee.equipment?.name || 'Unknown'}: OEE ${(oee.oee_score * 100).toFixed(1)}% (A: ${oee.availability}%, P: ${oee.performance}%, Q: ${oee.quality}%)`
      ).slice(0, 10).join('\n')}` : 'No OEE data available';

    // Create comprehensive prompt template
    const promptTemplate = PromptTemplate.fromTemplate(`
You are an OEE (Overall Equipment Effectiveness) Manufacturing Copilot with deep expertise in:
- Manufacturing operations and equipment management
- OEE calculations and optimization strategies
- Predictive maintenance and downtime reduction
- Production efficiency and quality improvement
- Root cause analysis for manufacturing issues
- Industry best practices and lean manufacturing

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

Provide a comprehensive, actionable response that:
1. Analyzes the current data context when relevant
2. Offers specific recommendations based on manufacturing best practices
3. Identifies trends, patterns, or areas for improvement
4. Suggests concrete next steps or investigations
5. Uses manufacturing terminology appropriately
6. Provides quantitative insights when possible

Response:
`);

    // Create the chain
    const chain = RunnableSequence.from([
      promptTemplate,
      llm,
      new StringOutputParser(),
    ]);

    // Generate response
    const response = await chain.invoke({
      question: message,
      equipmentSummary,
      oeeSummary,
    });

    // Save the conversation to database
    await supabase.from('chat_messages').insert([
      {
        session_id: sessionId,
        role: 'user',
        content: message,
      },
      {
        session_id: sessionId,
        role: 'assistant',
        content: response,
      },
    ]);

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
