import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TimeEntryData {
  user_id: string;
  datum: string;
  project_id?: string | null;
  disturbance_id?: string | null;
  taetigkeit: string;
  stunden: number;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  pause_start?: string | null;
  pause_end?: string | null;
  location_type: string;
  notizen?: string | null;
  week_type?: string | null;
}

interface TeamTimeEntriesRequest {
  mainEntry: TimeEntryData;
  teamEntries: TimeEntryData[];
  createWorkerLinks?: boolean; // Whether to create time_entry_workers links
  skipMainEntry?: boolean; // Skip creating main entry (for updates where main entry exists)
}

interface TeamTimeEntriesResponse {
  success: boolean;
  mainEntryId?: string;
  teamEntryIds?: string[];
  totalCreated?: number;
  error?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's token to verify identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub;

    // Parse request body
    const { mainEntry, teamEntries, createWorkerLinks = true, skipMainEntry = false }: TeamTimeEntriesRequest = await req.json();

    // Validate that the main entry belongs to the authenticated user
    if (mainEntry.user_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Main entry must belong to authenticated user" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service role key to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Validate team members exist and are active
    if (teamEntries.length > 0) {
      const teamUserIds = teamEntries.map(e => e.user_id);
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active")
        .in("id", teamUserIds);

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to validate team members" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const activeIds = new Set(profiles?.filter(p => p.is_active).map(p => p.id) || []);
      const invalidIds = teamUserIds.filter(id => !activeIds.has(id));
      
      if (invalidIds.length > 0) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid or inactive team members: ${invalidIds.length}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let mainEntryResult: { id: string } | null = null;
    let totalCreated = 0;

    // Insert main entry for the authenticated user (unless skipMainEntry is true)
    if (!skipMainEntry) {
      const { data: mainResult, error: mainError } = await supabaseAdmin
        .from("time_entries")
        .insert({
          user_id: mainEntry.user_id,
          datum: mainEntry.datum,
          project_id: mainEntry.project_id || null,
          disturbance_id: mainEntry.disturbance_id || null,
          taetigkeit: mainEntry.taetigkeit,
          stunden: mainEntry.stunden,
          start_time: mainEntry.start_time,
          end_time: mainEntry.end_time,
          pause_minutes: mainEntry.pause_minutes,
          pause_start: mainEntry.pause_start || null,
          pause_end: mainEntry.pause_end || null,
          location_type: mainEntry.location_type,
          notizen: mainEntry.notizen || null,
          week_type: mainEntry.week_type || null,
        })
        .select()
        .single();

      if (mainError) {
        console.error("Error inserting main entry:", mainError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to create main entry: ${mainError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      mainEntryResult = mainResult;
      totalCreated = 1;
    }

    const teamEntryIds: string[] = [];

    // Insert team entries
    for (const teamEntry of teamEntries) {
      const { data: teamEntryResult, error: teamError } = await supabaseAdmin
        .from("time_entries")
        .insert({
          user_id: teamEntry.user_id,
          datum: teamEntry.datum,
          project_id: teamEntry.project_id || null,
          disturbance_id: teamEntry.disturbance_id || null,
          taetigkeit: teamEntry.taetigkeit,
          stunden: teamEntry.stunden,
          start_time: teamEntry.start_time,
          end_time: teamEntry.end_time,
          pause_minutes: teamEntry.pause_minutes,
          pause_start: teamEntry.pause_start || null,
          pause_end: teamEntry.pause_end || null,
          location_type: teamEntry.location_type,
          notizen: teamEntry.notizen || null,
          week_type: teamEntry.week_type || null,
        })
        .select()
        .single();

      if (teamError) {
        console.error("Error inserting team entry:", teamError);
        // Continue with other entries but log the error
        continue;
      }

      teamEntryIds.push(teamEntryResult.id);
      totalCreated++;

      // Create worker link if requested and main entry exists
      if (createWorkerLinks && mainEntryResult) {
        const { error: linkError } = await supabaseAdmin
          .from("time_entry_workers")
          .insert({
            source_entry_id: mainEntryResult.id,
            user_id: teamEntry.user_id,
            target_entry_id: teamEntryResult.id,
          });

        if (linkError) {
          console.error("Error creating worker link:", linkError);
        }
      }
    }

    const response: TeamTimeEntriesResponse = {
      success: true,
      mainEntryId: mainEntryResult?.id || undefined,
      teamEntryIds,
      totalCreated,
    };

    console.log(`Created ${totalCreated} time entries (${mainEntryResult ? '1 main + ' : ''}${teamEntryIds.length} team members)`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
