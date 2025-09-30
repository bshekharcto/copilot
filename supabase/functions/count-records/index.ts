import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Test 1: Count with no limit
    const { count: countNoLimit, error: error1 } = await supabase
      .from('equipment_status_logs')
      .select('*', { count: 'exact', head: true });

    // Test 2: Fetch with default (should be 1000)
    const { data: dataDefault, error: error2 } = await supabase
      .from('equipment_status_logs')
      .select('*');

    // Test 3: Fetch with explicit range
    const { data: dataRange, error: error3 } = await supabase
      .from('equipment_status_logs')
      .select('*')
      .range(0, 10000);

    const result = {
      timestamp: new Date().toISOString(),
      tests: {
        countQuery: {
          totalRecords: countNoLimit,
          error: error1?.message
        },
        defaultFetch: {
          recordsFetched: dataDefault?.length || 0,
          error: error2?.message
        },
        rangeFetch: {
          recordsFetched: dataRange?.length || 0,
          error: error3?.message
        }
      },
      diagnosis: {
        hasLimitIssue: (countNoLimit || 0) > 50 && (dataDefault?.length || 0) === 50,
        recommendation: (countNoLimit || 0) > 50 && (dataDefault?.length || 0) === 50
          ? "Default query is limited to 50 records. Use range() to fetch more."
          : "No limit issue detected"
      }
    };

    return new Response(
      JSON.stringify(result, null, 2),
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